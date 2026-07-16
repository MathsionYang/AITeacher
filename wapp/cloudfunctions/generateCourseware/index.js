const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => ({
  ok: false,
  message: "generateCourseware 云函数骨架已创建：请在此接入模型调用、课件 Agent 和课件审核稿入库逻辑。",
  received: {
    unitId: event && event.unit && event.unit.id,
    pointCount: event && event.unit && event.unit.points ? event.unit.points.length : 0
  }
});
