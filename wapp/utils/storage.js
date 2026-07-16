const STORAGE_KEY = "eduforge_wapp_teacher_mvp_v1";

const initialState = {
  loggedIn: false,
  scope: null,
  currentUnitId: "g5a-u2",
  modelConfig: null,
  histories: {
    courseware: [],
    practice: [],
    schedule: []
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getState() {
  const stored = wx.getStorageSync(STORAGE_KEY);
  if (!stored) return clone(initialState);
  return Object.assign(clone(initialState), stored, {
    histories: Object.assign(clone(initialState.histories), stored.histories || {})
  });
}

function setState(state) {
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

function updateState(patch) {
  const state = getState();
  return setState(Object.assign(state, patch || {}));
}

function setLoggedIn(loggedIn) {
  return updateState({ loggedIn });
}

function addHistory(type, item) {
  const state = getState();
  const list = state.histories[type] || [];
  state.histories[type] = [item].concat(list.filter((record) => record.id !== item.id)).slice(0, 30);
  setState(state);
  return state.histories[type];
}

function deleteHistory(type, id) {
  const state = getState();
  state.histories[type] = (state.histories[type] || []).filter((record) => record.id !== id);
  setState(state);
  return state.histories[type];
}

function getHistories(type) {
  return getState().histories[type] || [];
}

function clearAll() {
  wx.removeStorageSync(STORAGE_KEY);
}

module.exports = {
  getState,
  setState,
  updateState,
  setLoggedIn,
  addHistory,
  deleteHistory,
  getHistories,
  clearAll
};
