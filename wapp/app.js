const storage = require("./utils/storage");
const curriculum = require("./data/curriculum");
const teacherService = require("./utils/teacher-service");

const defaultModelConfig = {
  provider: "cloudbase",
  providerName: "云开发",
  model: "云函数配置",
  cloudEnabled: false,
  cloudEnvId: "",
  connected: false
};

App({
  globalData: {
    teacher: {
      account: "teacher001",
      name: "王老师",
      verified: true
    },
    scope: curriculum.defaultScope,
    currentUnitId: "g5a-u2",
    modelConfig: defaultModelConfig,
    cloudInitialized: false,
    cloudEnvId: ""
  },

  onLaunch() {
    this.bootstrap();
    this.initCloud();
  },

  bootstrap() {
    const state = storage.getState();
    this.globalData.scope = state.scope || curriculum.defaultScope;
    this.globalData.currentUnitId = state.currentUnitId || this.globalData.currentUnitId;
    this.globalData.modelConfig = Object.assign({}, defaultModelConfig, state.modelConfig || {});
  },

  initCloud() {
    try {
      return teacherService.initCloudIfNeeded(this);
    } catch (error) {
      return false;
    }
  },

  getState() {
    return storage.getState();
  },

  saveState(patch) {
    const nextState = storage.updateState(patch);
    this.globalData.scope = nextState.scope || this.globalData.scope || curriculum.defaultScope;
    this.globalData.currentUnitId = nextState.currentUnitId || this.globalData.currentUnitId;
    this.globalData.modelConfig = Object.assign({}, defaultModelConfig, nextState.modelConfig || this.globalData.modelConfig || {});
    this.initCloud();
    return nextState;
  },

  getUnits() {
    return curriculum.getUnits(this.globalData.scope);
  },

  getCurrentUnit() {
    const units = this.getUnits();
    return curriculum.findUnit(units, this.globalData.currentUnitId) || units[0];
  },

  setCurrentUnit(unitId) {
    this.globalData.currentUnitId = unitId;
    return this.saveState({ currentUnitId: unitId });
  },

  setScope(scopePatch) {
    const scope = Object.assign({}, this.globalData.scope, scopePatch);
    const units = curriculum.getUnits(scope);
    const currentUnitId = units[0] ? units[0].id : this.globalData.currentUnitId;
    this.globalData.scope = scope;
    this.globalData.currentUnitId = currentUnitId;
    return this.saveState({ scope, currentUnitId });
  },

  setModelConfig(modelConfig) {
    this.globalData.modelConfig = Object.assign({}, defaultModelConfig, this.globalData.modelConfig, modelConfig);
    return this.saveState({ modelConfig: this.globalData.modelConfig });
  },

  addHistory(type, item) {
    return storage.addHistory(type, item);
  },

  deleteHistory(type, id) {
    return storage.deleteHistory(type, id);
  },

  getHistories(type) {
    return storage.getHistories(type);
  }
});
