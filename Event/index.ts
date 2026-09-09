/**
 * CocoFrameQX - Event 模块导出
 */

// 1. 纯 TypeScript 事件中心核心本体（零引擎依赖）
export * from './EventTypes';
export * from './EventCenter';
export * from './EventScope';

// 2. Cocos Creator 引擎专属外挂扩展（生命周期防御与组件装饰器）
export * from './CocosExtension';
