import '@testing-library/jest-dom/vitest';

// jsdom 未实现 scrollIntoView（WorklogPanel 补标注跳转用其做滚动定位），补 no-op 以免报错
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
