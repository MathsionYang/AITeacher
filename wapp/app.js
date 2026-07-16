const storage = require("./utils/storage");
const mock = require("./data/mock");

const defaultModelConfig = {
  provider: "local_proxy",
  providerName: "本地代理",
  model: "qwen-plus",
  baseUrl: "http://127.0.0.1:8787",
  apiKey: "",
  connected: false
};

App({
  globalData: {
    teacher: {
      account: "teacher001",
      name: "王老师",
      verified: true
    },
    scope: mock.defaultScope,
    currentUnitId: "g5a-u2",
    modelConfig: defaultModelConfig
  },

  onLaunch() {
    this.bootstrap();
  },

  bootstrap() {
    const state = storage.getState();
    this.globalData.scope = state.scope || mock.defaultScope;
    this.globalData.currentUnitId = state.currentUnitId || this.globalData.currentUnitId;
    this.globalData.modelConfig = state.modelConfig || defaultModelConfig;
  },

  getState() {
    return storage.getState();
  },

  saveState(patch) {
    const nextState = storage.updateState(patch);
    this.globalData.scope = nextState.scope || this.globalData.scope || mock.defaultScope;
    this.globalData.currentUnitId = nextState.currentUnitId || this.globalData.currentUnitId;
    this.globalData.modelConfig = nextState.modelConfig || this.globalData.modelConfig || defaultModelConfig;
    return nextState;
  },

  getUnits() {
    return mock.getUnits(this.globalData.scope);
  },

  getCurrentUnit() {
    const units = this.getUnits();
    return mock.findUnit(units, this.globalData.currentUnitId) || units[0];
  },

  setCurrentUnit(unitId) {
    this.globalData.currentUnitId = unitId;
    return this.saveState({ currentUnitId: unitId });
  },

  setScope(scopePatch) {
    const scope = Object.assign({}, this.globalData.scope, scopePatch);
    const units = mock.getUnits(scope);
    const currentUnitId = units[0] ? units[0].id : this.globalData.currentUnitId;
    this.globalData.scope = scope;
    this.globalData.currentUnitId = currentUnitId;
    return this.saveState({ scope, currentUnitId });
  },

  setModelConfig(modelConfig) {
    this.globalData.modelConfig = Object.assign({}, this.globalData.modelConfig, modelConfig);
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
