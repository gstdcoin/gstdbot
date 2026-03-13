/**
 * GSTD Node OS — Sovereign Instrument Suite
 *
 * All financial and governance instruments built into every node:
 * - Auto-Staking: earnings auto-compound for maximum yield
 * - P2P Payments: send/receive GSTD zero-fee between nodes
 * - Mesh Discovery: find and connect to peer nodes directly
 * - Consensus Voting: validate task results with other nodes
 * - Governance: vote on protocol changes
 * - Revenue Analytics: track node profitability in real-time
 * - Auto-Lending: offer idle GSTD as micro-loans
 * - Capability Broadcasting: advertise node hardware to network
 */
import type { NodeConfig } from '../index.js';
import type { NodeWallet } from '../wallet/manager.js';
export interface SovereignState {
    stakedAmount: number;
    stakingAPY: number;
    stakingEarned: number;
    autoCompound: boolean;
    paymentsSent: number;
    paymentsReceived: number;
    totalTransferred: number;
    meshPeers: MeshPeer[];
    meshScore: number;
    activeProposals: number;
    votesSubmitted: number;
    governancePower: number;
    hourlyRate: number;
    dailyEstimate: number;
    monthlyEstimate: number;
    yearlyEstimate: number;
    profitableHoursPerDay: number;
    costPerHourUSD: number;
    revenuePerHourGSTD: number;
    loansGiven: number;
    interestEarned: number;
    capabilities: string[];
    autonomousMode: boolean;
}
export interface MeshPeer {
    nodeId: string;
    endpoint: string;
    latencyMs: number;
    trust: number;
    lastSeen: string;
}
export interface ProfitReport {
    uptimeReward: number;
    queryReward: number;
    stakingYield: number;
    revenueShare: number;
    referralBonus: number;
    lendingInterest: number;
    totalDaily: number;
    totalMonthly: number;
    totalYearly: number;
    nodeOperatingCostUSD: number;
    profitMultiplier: number;
}
export declare class SovereignSuite {
    private config;
    private wallet;
    private apiUrl;
    private state;
    private profitTracker;
    private meshTimer;
    private stakingTimer;
    private governanceTimer;
    private profitTimer;
    private lendingTimer;
    constructor(config: NodeConfig, wallet: NodeWallet);
    start(): Promise<void>;
    stop(): Promise<void>;
    getState(): SovereignState;
    getProfitReport(): ProfitReport;
    private meshAnnounce;
    private registerCapabilities;
    private syncStakingState;
    autoCompoundRewards(): Promise<void>;
    sendPayment(receiverWallet: string, amount: number, memo?: string): Promise<any>;
    getPaymentHistory(): Promise<any>;
    private syncGovernance;
    voteOnProposal(proposalId: string, vote: 'for' | 'against' | 'abstain'): Promise<any>;
    createProposal(title: string, description: string): Promise<any>;
    submitConsensusVote(taskId: string, resultHash: string): Promise<any>;
    private autoLendIdleFunds;
    private calculateProfitability;
    getNodeEconomics(): any;
    private apiPost;
    private apiGet;
}
//# sourceMappingURL=sovereign.d.ts.map