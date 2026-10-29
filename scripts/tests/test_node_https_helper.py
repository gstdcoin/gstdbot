"""Isolated helper tests: no root, systemd, public listeners, DNS or ACME traffic."""
import importlib.util
import json
import os
import pathlib
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("https_helper", pathlib.Path(__file__).parents[1] / "node-https-helper.py")
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
DOMAIN = "node.example.org"
EMAIL = "operator@example.org"
BODY = {"action":"configure", "domain":DOMAIN, "email":EMAIL, "agreeTerms":True, "exposePublic":True}

class Runner:
    def __init__(self, active=False, invalid=False):
        self.calls, self.enabled, self.invalid = [], active, invalid
    def __call__(self, args, timeout=30):
        self.calls.append(args)
        if args[:3] == ["/usr/bin/systemctl", "is-active", "--quiet"]:
            if args[-1] != helper.SERVICE or not self.enabled:
                raise subprocess.CalledProcessError(3, args)
        elif "validate" in args and self.invalid:
            raise subprocess.CalledProcessError(1, args)
        elif args[1:2] == ["stop"]:
            self.enabled = False
        elif args[1:2] in (["start"], ["restart"]):
            self.enabled = True

class HelperTests(unittest.TestCase):
    def setUp(self):
        group = patch.object(helper.grp, "getgrnam", return_value=MagicMock(gr_gid=os.getgid()))
        group.start()
        self.addCleanup(group.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def manager(self, runner=None, resolver=lambda domain: {"8.8.8.8"}, probe=lambda domain:"2030-01-01T00:00:00+00:00"):
        return helper.Manager({"uid":1001,"port":8081}, self.root, runner or Runner(),
                              resolver=resolver, probe=probe, wait=lambda seconds: None)
    def test_strict_inputs_and_consent(self):
        self.assertEqual(helper.validate(BODY), (DOMAIN,EMAIL))
        for key,value in (("domain","node.example.org\n{ admin :2019 }"),("domain","127.0.0.1"),
                          ("domain","evil.internal"),("domain","https://node.example.org"),("domain","*.example.org"),
                          ("domain","x.example.org/path"),("email","a@b.org\nimport /etc/passwd"),("agreeTerms","true"),
                          ("exposePublic",False)):
            with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                helper.validate({**BODY,key:value})
        with self.assertRaises(ValueError):
            helper.validate({**BODY,"port":22})
    def test_tls_probe_has_a_hard_subprocess_deadline(self):
        with patch.object(helper.subprocess,"run") as run:
            run.return_value.stdout='"2030-01-01T00:00:00+00:00"'
            self.assertTrue(helper.bounded_tls_probe(DOMAIN))
            self.assertEqual(run.call_args.kwargs["timeout"],6)
            self.assertEqual(run.call_args.args[0][-2:],["--tls-probe",DOMAIN])
            run.side_effect=subprocess.TimeoutExpired("probe",6)
            with self.assertRaisesRegex(ValueError,"tls_not_verified"):
                helper.bounded_tls_probe(DOMAIN)
    def test_fixed_root_owned_configuration_and_issuer(self):
        config = helper.render_config(DOMAIN, EMAIL, 8081)
        self.assertIn("dir "+helper.CA,config)
        self.assertIn("reverse_proxy 127.0.0.1:8081",config)
        self.assertIn("admin unix//var/lib/gstd-node-https/admin/caddy.sock",config)
        self.assertNotIn(":2019",config)
        for value in (80,443,True,8081.5,"8081",65536):
            with self.assertRaises(ValueError):
                helper.render_config(DOMAIN,EMAIL,value)
    def test_dns_is_bounded_and_rejects_any_private_record(self):
        with patch.object(helper.subprocess,"run") as run:
            run.return_value.stdout = '["8.8.8.8","127.0.0.1"]'
            with self.assertRaises(ValueError):
                helper.resolve_public(DOMAIN)
            self.assertEqual(run.call_args.kwargs["timeout"],5)
            self.assertEqual(run.call_args.args[0][-1],DOMAIN)
            run.return_value.stdout = '["8.8.8.8"]'
            self.assertEqual(helper.resolve_public(DOMAIN),{"8.8.8.8"})
    def test_preflight_failure_never_restarts_working_proxy(self):
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,EMAIL,8081))
        runner=Runner(active=True)
        def fail(domain): raise ValueError("domain_not_public")
        manager=self.manager(runner,resolver=fail)
        manager.state={"state":"configuring","domain":DOMAIN,"verified":False}
        old={"state":"verified","domain":DOMAIN,"verified":True}
        manager.configure(DOMAIN,EMAIL,old)
        self.assertEqual((self.root/"Caddyfile").read_text(),helper.render_config(DOMAIN,EMAIL,8081))
        self.assertFalse(any(call[1] in ("start","stop","restart","reload") for call in runner.calls if call[0]=="/usr/bin/systemctl"))
        self.assertEqual(manager.state["error"],"domain_not_public")
    def test_success_requires_tls_and_keeps_no_key_in_status(self):
        runner=Runner()
        manager=self.manager(runner)
        manager.preflight=lambda domain:None  # Never bind production ports in tests.
        manager.state={"state":"configuring","domain":DOMAIN,"verified":False}
        manager.configure(DOMAIN,EMAIL)
        state=manager.status()
        self.assertTrue(state["verified"])
        self.assertFalse(state["externalVerified"])
        self.assertEqual(state["upstreamPort"],8081)
        self.assertNotIn(EMAIL,json.dumps(state))
        self.assertNotIn("privkey",json.dumps(state))
        self.assertEqual((self.root/"Caddyfile").stat().st_mode & 0o777,0o640)
        self.assertEqual((self.root/"status.json").stat().st_mode & 0o777,0o600)
    def test_first_failure_stops_service_removes_config_and_has_no_retry_loop(self):
        runner=Runner()
        def bad(domain): raise ValueError("not_verified")
        manager=self.manager(runner,probe=bad)
        manager.preflight=lambda domain:None
        manager.state={"state":"configuring","domain":DOMAIN,"verified":False}
        manager.configure(DOMAIN,EMAIL)
        self.assertEqual(manager.state["state"],"failed")
        self.assertFalse((self.root/"Caddyfile").exists())
        self.assertFalse(runner.enabled)
        self.assertEqual(len([x for x in runner.calls if x[1:2]==["start"]]),1)
        self.assertEqual(len([x for x in runner.calls if x[1:2]==["stop"]]),1)
    def test_failed_reconfiguration_restores_managed_config_and_previous_domain(self):
        previous=helper.render_config(DOMAIN,EMAIL,8081)
        (self.root/"Caddyfile").write_text(previous)
        runner=Runner(active=True,invalid=True)
        manager=self.manager(runner)
        manager.preflight=lambda domain:None
        manager.state={"state":"configuring","domain":DOMAIN}
        manager.configure(DOMAIN,"new@example.org",{"state":"verified","domain":DOMAIN,"verified":True})
        self.assertEqual((self.root/"Caddyfile").read_text(),previous)
        self.assertEqual(manager.state["domain"],DOMAIN)
        self.assertEqual(manager.state["lastAttemptError"],"https_setup_failed")
        self.assertTrue(runner.enabled)
    def test_different_domain_cannot_displace_working_route(self):
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,EMAIL,8081))
        manager=self.manager()
        with self.assertRaisesRegex(ValueError,"domain_change_requires_manual"):
            manager.start({**BODY,"domain":"other.example.org"})
    def test_existing_files_and_another_proxy_are_not_certificate_success(self):
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,EMAIL,8081))
        manager=self.manager(Runner(active=False))
        manager.state={"state":"verified","domain":DOMAIN,"verified":True}
        manager.probe=MagicMock(return_value="2030-01-01T00:00:00+00:00")
        self.assertFalse(manager.status()["verified"])
        manager.probe.assert_not_called()
    def test_cooldown_survives_control_service_restart(self):
        (self.root/"status.json").write_text(json.dumps({"domain":DOMAIN,"retryAfterEpoch":time.time()+600}))
        manager=self.manager()
        with self.assertRaisesRegex(ValueError,"https_cooldown"):
            manager.start(BODY)
    def test_interrupted_first_setup_is_stopped_without_another_acme_attempt(self):
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,EMAIL,8081))
        (self.root/"status.json").write_text(json.dumps({"state":"configuring","domain":DOMAIN,"hadPrevious":False,"retryAfterEpoch":time.time()+600}))
        runner=Runner(active=True)
        def bad(domain): raise ValueError("unverified")
        manager=self.manager(runner,probe=bad)
        manager.worker.join(2)
        self.assertFalse(manager.worker.is_alive())
        self.assertEqual(manager.state["error"],"pending_setup_interrupted")
        self.assertFalse((self.root/"Caddyfile").exists())
        self.assertFalse(runner.enabled)
        self.assertFalse(any(call[1] in ("start","reload","restart","enable") for call in runner.calls))
        with self.assertRaisesRegex(ValueError,"https_cooldown"):
            manager.start(BODY)
    def test_interrupted_but_verified_setup_enables_renewal_without_new_issuance(self):
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,EMAIL,8081))
        (self.root/"status.json").write_text(json.dumps({"state":"configuring","domain":DOMAIN,"hadPrevious":False,"retryAfterEpoch":time.time()+600}))
        runner=Runner(active=True)
        manager=self.manager(runner)
        manager.worker.join(2)
        self.assertTrue(manager.state["verified"])
        self.assertTrue(any(call[1:2]==["enable"] for call in runner.calls))
        self.assertFalse(any(call[1] in ("start","stop","reload","restart") for call in runner.calls))
    def test_interrupted_replacement_restores_previous_service_gracefully(self):
        previous=helper.render_config(DOMAIN,EMAIL,8081)
        (self.root/"Caddyfile").write_text(helper.render_config(DOMAIN,"new@example.org",8081))
        (self.root/"previous-Caddyfile").write_text(previous)
        (self.root/"status.json").write_text(json.dumps({"state":"configuring","domain":DOMAIN,"hadPrevious":True,"previousActive":True}))
        runner=Runner(active=True)
        def bad(domain): raise ValueError("unverified")
        manager=self.manager(runner,probe=bad)
        manager.worker.join(2)
        self.assertEqual((self.root/"Caddyfile").read_text(),previous)
        self.assertTrue(runner.enabled)
        self.assertTrue(any(call[1:2]==["reload"] for call in runner.calls))
        self.assertFalse(any(call[1] in ("stop","restart") for call in runner.calls))
    def test_peer_uid_and_request_size_checked_before_any_actions(self):
        manager=MagicMock()
        connection=MagicMock()
        connection.getsockopt.return_value=helper.struct.pack("3i",10,9999,9999)
        self.assertEqual(helper.receive(connection,1001,manager),{"error":"access_denied"})
        manager.status.assert_not_called()
        connection.getsockopt.return_value=helper.struct.pack("3i",10,1001,1001)
        connection.recv.side_effect=[b"x"*1024]*5
        self.assertEqual(helper.receive(connection,1001,manager),{"error":"request_too_large"})
    def test_deep_json_does_not_kill_control_service(self):
        connection=MagicMock()
        connection.getsockopt.return_value=helper.struct.pack("3i",10,1001,1001)
        payload=("["*1100+"0"+"]"*1100+"\n").encode()
        connection.recv.side_effect=[payload[:1024],payload[1024:2048],payload[2048:]]
        self.assertEqual(helper.receive(connection,1001,self.manager()),{"error":"invalid_request"})
        connection.recv.side_effect=[b"{}\n"]
        with patch.object(helper.json,"loads",side_effect=RecursionError):
            self.assertEqual(helper.receive(connection,1001,self.manager()),{"error":"invalid_request"})
    def test_local_tls_probe_cannot_follow_dns_to_other_hosts(self):
        cert={"issuer":((("organizationName","Let's Encrypt"),),),"notAfter":time.strftime("%b %d %H:%M:%S %Y GMT",time.gmtime(time.time()+864000))}
        tls=MagicMock();tls.getpeercert.return_value=cert
        context=MagicMock();context.wrap_socket.return_value.__enter__.return_value=tls
        response=MagicMock();response.status=200;response.read.return_value=b'{"status":"ok","security":{"pinAuth":true}}'
        with patch.object(helper.socket,"create_connection") as connect, patch.object(helper.ssl,"create_default_context",return_value=context), patch.object(helper.http.client,"HTTPResponse",return_value=response):
            self.assertTrue(helper.verify_local_tls(DOMAIN))
            self.assertEqual(connect.call_args.args[0],("127.0.0.1",443))
            self.assertEqual(context.wrap_socket.call_args.kwargs["server_hostname"],DOMAIN)
            response.status=502
            with self.assertRaises(ValueError):
                helper.verify_local_tls(DOMAIN)
            response.status=200;response.begin.side_effect=helper.http.client.BadStatusLine("invalid")
            with self.assertRaisesRegex(ValueError,"gateway_health_failed"):
                helper.verify_local_tls(DOMAIN)
            response.begin.side_effect=None
            response.status=200;cert["issuer"]=((("organizationName","Other CA"),),)
            with self.assertRaisesRegex(ValueError,"issuer_not_letsencrypt"):
                helper.verify_local_tls(DOMAIN)

if __name__=="__main__":
    unittest.main()
