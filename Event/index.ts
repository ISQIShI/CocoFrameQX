// 纯 TypeScript 入口，不加载 cc。Cocos 生命周期适配请显式导入 ./CocosExtension。
export { createEvent, EventDispatchError } from './EventTypes';
export type { EventToken, EventListener, EventArguments, Subscription, EventOptions, EventFailure, EventCenterOptions, EventDiagnostic } from './EventTypes';
export { EventCenter } from './EventCenter';
export { EventScope } from './EventScope';
