process.env.GSTD_INFERENCE_DEVICE = 'cpu';
process.env.GSTD_MAX_INFERENCE_CONCURRENCY = '1';
process.env.GSTD_DEFAULT_MODEL ||= 'qwen2.5:0.5b';
process.env.GSTD_OLLAMA_CONTEXT ||= '1024';
process.env.OLLAMA_NO_CLOUD = '1';
require('../dist/index.js');
