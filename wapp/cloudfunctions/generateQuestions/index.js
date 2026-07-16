const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => ({
  ok: false,
  message: "generateQuestions 云函数骨架已创建：请在此接入出题 Agent、规则引擎校验和试卷入库逻辑。",
  received: {
    mode: event && event.mode,
    unitId: event && event.unit && event.unit.id,
    requestedCount: event && event.count
  }
});
