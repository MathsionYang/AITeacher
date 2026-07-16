const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => ({
  ok: true,
  provider: process.env.LLM_PROVIDER || "cloudbase",
  model: process.env.LLM_MODEL || "未配置",
  message: process.env.LLM_API_KEY ? "模型 Key 已在云函数环境变量中配置" : "云函数可用，但尚未配置模型 Key"
});
