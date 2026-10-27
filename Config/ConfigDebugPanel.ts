import { ConfigExportScope, ConfigField, ConfigSchema, ConfigUpdateResult, ConfigValue } from './ConfigTypes';
import { ConfigTestSession, message } from './ConfigTestSession';
import { CONFIG_TEXT_LIMIT, configEqual } from './ConfigStore';

/** 面板打开时项目可暂停自己的输入；关闭时只撤销这一个暂停原因。 */
export interface ConfigPanelOptions { onVisibilityChange?: (visible: boolean) => void }

/** 一个字段的面板控件与读取函数。 */
interface FieldControl { element: HTMLElement; read: () => ConfigValue }

/** 未声明分组的字段在面板中的归类名称。 */
const UNGROUPED = '未分组';

/**
 * 无需 Cocos 场景节点的 Web 测试面板，适用于编辑器浏览器预览和已打包的 Web 页面。
 * 原生或无 DOM 环境不创建面板，仍可使用核心及存储适配器。
 */
export class ConfigDebugPanel<S extends ConfigSchema> {
    private host: HTMLDivElement | null = null;
    private panel: HTMLDivElement | null = null;
    private rows: HTMLDivElement | null = null;
    private status: HTMLDivElement | null = null;
    private text: HTMLTextAreaElement | null = null;
    private search: HTMLInputElement | null = null;
    private readers = new Map<string, () => ConfigValue>();
    /** 用户折叠过的分组，重建控件后保持折叠。 */
    private readonly collapsed = new Set<string>();
    private unsubscribe: (() => void) | null = null;
    private visible = false;
    private readonly handlers: { type: string; listener: EventListener }[] = [];

    /** 保留测试会话和输入协调回调；构造本身不创建 DOM 或监听。 */
    constructor(private readonly session: ConfigTestSession<S>, private readonly options: ConfigPanelOptions = {}) {}

    /** 创建“参数”入口；关闭测试能力或没有 DOM 时返回 false，不影响游戏启动。 */
    mount(): boolean {
        if (this.host) return true;
        if (!this.session.enabled || typeof document === 'undefined' || !document.body) return false;
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;pointer-events:auto;';
        host.setAttribute('data-qx-config', this.session.store.project);
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host{font:14px/1.5 system-ui;color:#e6edf3;color-scheme:dark}*{box-sizing:border-box}' +
            'button,input,select,textarea{font:inherit}button{cursor:pointer;background:#283747;color:#fff;border:1px solid #57718b;border-radius:5px;padding:6px 10px}' +
            '.面板{width:min(620px,calc(100vw - 16px));max-height:calc(100vh - 64px);max-height:calc(100dvh - 64px);overflow:auto;background:#16212c;border:1px solid #63829d;border-radius:8px;padding:12px;touch-action:pan-y}' +
            '.工具{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.参数{padding:8px 0;border-bottom:1px solid #344657}.说明{font-size:12px;color:#b4c6d6;overflow-wrap:anywhere}' +
            'input:not([type=checkbox]),select,textarea{width:100%;background:#0c1620;color:#fff;border:1px solid #57718b;border-radius:4px;padding:6px}' +
            '.分量{display:flex;gap:4px}.分量 input{min-width:0}details{border-top:1px solid #344657}summary{cursor:pointer;padding:6px 0;font-weight:600}' +
            'textarea{min-height:80px;resize:vertical}.状态{white-space:pre-wrap;color:#ffe2a1;margin:8px 0}h3{margin:0}label{display:block}';
        root.appendChild(style);
        const toggle = this.button('参数', () => this.setVisible(!this.visible));
        root.appendChild(toggle);
        const panel = this.element('div', '面板'); panel.hidden = true; root.appendChild(panel);
        const title = document.createElement('h3'); title.textContent = '测试参数 · ' + this.session.store.project; panel.appendChild(title);
        const note = this.element('div', '说明');
        note.textContent = '先修改再应用，只提交改动过的参数；标注“重启”的字段不会改变本局。保存只保存在当前浏览器。';
        panel.appendChild(note);
        this.search = document.createElement('input'); this.search.placeholder = '搜索标题、分组或参数键';
        this.search.addEventListener('input', () => this.filter()); panel.appendChild(this.search);
        this.status = this.element('div', '状态'); this.status.setAttribute('role', 'status'); panel.appendChild(this.status);
        this.rows = this.element('div'); panel.appendChild(this.rows);
        const actions = this.element('div', '工具'); panel.appendChild(actions);
        actions.appendChild(this.button('应用参数', () => this.run(() => this.reportApply(this.apply()))));
        actions.appendChild(this.button('保存到本机', () => this.run(() => { this.apply(); this.session.save(); this.reportState('已保存改动，下次打开生效'); })));
        actions.appendChild(this.button('恢复项目参数', () => this.run(() => {
            const issues = this.session.reset(); this.render(); this.reportState(['已清除测试覆盖', ...issues].join('\n'));
        })));
        actions.appendChild(this.button('关闭', () => this.setVisible(false)));
        this.text = document.createElement('textarea'); this.text.maxLength = CONFIG_TEXT_LIMIT;
        this.text.placeholder = '在此粘贴配置 JSON；导出的 JSON 或复现链接也显示在此';
        this.text.setAttribute('aria-label', '配置导入导出内容'); panel.appendChild(this.text);
        const exchange = this.element('div', '工具'); panel.appendChild(exchange);
        exchange.appendChild(this.button('导入 JSON', () => this.run(() => this.reportImport(this.session.store.importDocument(this.text!.value), 'JSON 已导入'))));
        exchange.appendChild(this.button('导出改动', () => this.run(() => this.exportText('改动'))));
        exchange.appendChild(this.button('导出全部', () => this.run(() => this.exportText('全部'))));
        exchange.appendChild(this.button('下载 JSON', () => this.run(() => { this.apply(); this.download(); })));
        exchange.appendChild(this.button('生成复现链接', () => this.run(() => {
            this.apply(); this.text!.value = this.session.shareURL(); this.reportState('链接已生成，只携带相对项目参数的改动；打开后按目标值启动');
        })));
        const upload = document.createElement('input'); upload.type = 'file'; upload.accept = '.json,application/json';
        upload.setAttribute('aria-label', '选择配置 JSON 文件');
        upload.addEventListener('change', () => {
            const file = upload.files?.[0];
            if (!file) return;
            if (file.size > CONFIG_TEXT_LIMIT * 4) { this.report('文件过大，请导入小于 256K 的 JSON'); return; }
            const reader = new FileReader();
            reader.onload = () => {
                if (!this.host) return;
                this.run(() => {
                    const issues = this.session.store.importDocument(String(reader.result));
                    this.text!.value = String(reader.result);
                    this.reportImport(issues, '文件已导入');
                });
                upload.value = '';
            };
            reader.onerror = () => { if (this.host) this.report('文件读取失败，请直接粘贴 JSON'); };
            reader.readAsText(file);
        });
        panel.appendChild(upload);
        // 阻止面板内事件冒泡到游戏的全局监听；捕获阶段输入由项目的可见性回调协调暂停。
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'keydown', 'keyup']) {
            const listener: EventListener = event => event.stopPropagation();
            host.addEventListener(type, listener);
            this.handlers.push({ type, listener });
        }
        this.host = host; this.panel = panel; document.body.appendChild(host);
        this.unsubscribe = this.session.store.subscribe(() => { this.render(); this.reportState('配置已更新'); });
        this.render(); this.reportState('参数已加载');
        if (this.session.panelRequested) this.setVisible(true);
        return true;
    }

    /** 显示或收起面板；不擅自暂停引擎或清除项目已有的其他暂停状态。 */
    setVisible(visible: boolean): void {
        if (!this.panel || this.visible === visible) return;
        this.visible = visible; this.panel.hidden = !visible;
        try { this.options.onVisibilityChange?.(visible); }
        catch (error) { this.report('项目输入协调回调失败：' + message(error)); }
    }

    /** 解除订阅与事件并删除自身节点，供场景退出或预览结束调用。 */
    dispose(): void {
        this.setVisible(false);
        this.unsubscribe?.(); this.unsubscribe = null;
        for (const { type, listener } of this.handlers) this.host?.removeEventListener(type, listener);
        this.handlers.length = 0;
        this.host?.remove(); this.host = null; this.panel = null; this.rows = null;
        this.status = null; this.text = null; this.search = null; this.readers.clear();
    }

    /** 按分组生成控件；当前值与待重启的目标值分别呈现，折叠状态在重建后保留。 */
    private render(): void {
        if (!this.rows) return;
        this.rows.replaceChildren(); this.readers.clear();
        const snapshot = this.session.store.snapshot();
        const desired = snapshot.desired as unknown as Record<string, ConfigValue>;
        const active = snapshot.active as unknown as Record<string, ConfigValue>;
        const groups = new Map<string, HTMLDetailsElement>();
        for (const [key, field] of this.session.store.fields()) {
            const name = field.group || UNGROUPED;
            let section = groups.get(name);
            if (!section) {
                section = document.createElement('details'); section.open = !this.collapsed.has(name); section.dataset.group = name;
                const summary = document.createElement('summary'); summary.textContent = name; section.appendChild(summary);
                const target = section;
                // 搜索时自动展开的分组不记入用户折叠状态。
                section.addEventListener('toggle', () => {
                    if (this.query()) return;
                    if (target.open) this.collapsed.delete(name); else this.collapsed.add(name);
                });
                groups.set(name, section); this.rows.appendChild(section);
            }
            const row = this.element('div', '参数');
            row.dataset.search = [key, field.label, field.group || ''].join(' ').toLowerCase();
            const label = document.createElement('label');
            label.appendChild(document.createTextNode((field.group ? field.group + ' / ' : '') + field.label + ' · ' + (field.timing || '重启')));
            const control = this.control(field, desired[key]);
            this.readers.set(key, control.read);
            label.appendChild(control.element); row.appendChild(label);
            const description = this.element('div', '说明');
            const limits = field.kind === '数值' || field.kind === '向量';
            description.textContent = key + '；来源：' + snapshot.sources[key] +
                (limits ? '；范围：' + (field.min ?? '不限') + ' ～ ' + (field.max ?? '不限') : '') +
                (field.description ? '；' + field.description : '') +
                (snapshot.pendingRestart.indexOf(key) !== -1 ? '；当前仍为：' + JSON.stringify(active[key]).slice(0, 160) : '');
            row.appendChild(description); section.appendChild(row);
        }
        this.filter();
    }

    /** 按字段类型生成控件；新增字段类型时与容器的校验表各加一项。 */
    private control(field: ConfigField, value: ConfigValue): FieldControl {
        switch (field.kind) {
            case '开关': {
                const input = document.createElement('input'); input.type = 'checkbox'; input.checked = value as boolean;
                return { element: input, read: () => input.checked };
            }
            case '选项': {
                const select = document.createElement('select');
                for (const choice of field.choices) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; select.appendChild(option); }
                select.value = String(value);
                return { element: select, read: () => select.value };
            }
            case '数据': {
                const input = document.createElement('textarea'); input.value = JSON.stringify(value, null, 2); input.maxLength = CONFIG_TEXT_LIMIT;
                return { element: input, read: () => {
                    try { return JSON.parse(input.value) as ConfigValue; }
                    catch { throw new Error(field.label + ' 不是有效的 JSON'); }
                } };
            }
            case '向量': {
                const box = this.element('div', '分量');
                const inputs = field.components.map((component, i) => {
                    const input = this.numberInput(field, (value as number[])[i]);
                    input.setAttribute('aria-label', field.label + ' ' + component); input.title = component;
                    box.appendChild(input); return input;
                });
                return { element: box, read: () => inputs.map((input, i) => this.readNumber(input, field.label + ' ' + field.components[i])) };
            }
            case '数值': {
                const input = this.numberInput(field, value as number);
                return { element: input, read: () => this.readNumber(input, field.label) };
            }
            default: {
                const input = document.createElement('input'); input.type = 'text'; input.value = String(value);
                input.maxLength = field.maxLength ?? 1024;
                return { element: input, read: () => input.value };
            }
        }
    }

    /** 创建带范围与步长的数字输入框。 */
    private numberInput(field: { min?: number; max?: number; step?: number; integer?: boolean }, value: number): HTMLInputElement {
        const input = document.createElement('input'); input.type = 'number'; input.value = String(value);
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? (field.integer ? 1 : 'any'));
        return input;
    }

    /** 读取数字输入，空值直接报错而不当作零。 */
    private readNumber(input: HTMLInputElement, label: string): number {
        if (!input.value.trim()) throw new Error(label + ' 不能为空');
        return Number(input.value);
    }

    /** 只提交与当前目标值不同的字段，保留其余字段的来源；整批校验保证跨字段关系不出现短暂非法状态。 */
    private apply(): ConfigUpdateResult {
        const desired = this.session.store.snapshot().desired as unknown as Record<string, ConfigValue>;
        const changes: Record<string, ConfigValue> = Object.create(null);
        this.readers.forEach((read, key) => {
            const value = read();
            if (!configEqual(value, desired[key])) changes[key] = value;
        });
        if (!Object.keys(changes).length) return { changed: false, deferred: false };
        return this.session.store.patchLayer('会话', changes);
    }

    /** 按应用结果提示：无改动、正常应用或整体推迟到重启。 */
    private reportApply(result: ConfigUpdateResult): void {
        if (!result.changed) this.reportState('没有改动');
        else if (result.deferred) this.reportState('参数已作为重启生效保存：本次改动中的实时参数与本局重启参数组合不合法，已整体推迟到重启');
        else this.reportState('参数已应用');
    }

    /** 提示导入结果，并列出宽松导入跳过的内容。 */
    private reportImport(issues: readonly string[], text: string): void {
        this.reportState([text, ...issues].join('\n'));
    }

    /** 先应用面板输入，再把指定范围的配置写入文本框。 */
    private exportText(scope: ConfigExportScope): void {
        this.apply(); this.text!.value = this.session.store.exportJSON(scope);
        this.reportState(scope === '改动' ? '已导出相对项目参数的改动，可复制或下载' : '已导出完整目标值，可作为项目配置文件');
    }

    /** 当前搜索词。 */
    private query(): string { return this.search?.value.trim().toLowerCase() || ''; }

    /** 按标题、分组或稳定键筛选；搜索时展开命中分组、隐藏无命中分组，清空后恢复用户折叠状态。 */
    private filter(): void {
        const query = this.query();
        for (const child of Array.from(this.rows?.children || [])) {
            const section = child as HTMLDetailsElement;
            let matches = 0;
            for (const item of Array.from(section.querySelectorAll('.参数'))) {
                const row = item as HTMLElement, hit = (row.dataset.search || '').indexOf(query) !== -1;
                row.hidden = !hit; if (hit) matches++;
            }
            section.hidden = matches === 0;
            section.open = query ? matches > 0 : !this.collapsed.has(section.dataset.group || '');
        }
    }

    /** 生成标准按钮，统一使用显式点击行为，不注册全局快捷键。 */
    private button(label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', action); return button;
    }

    /** 创建普通容器，使用文本节点展示外部输入，避免把配置当作 HTML。 */
    private element(tag: 'div', className = ''): HTMLDivElement {
        const node = document.createElement(tag); node.className = className; return node;
    }

    /** 下载相对项目参数的改动，并及时释放临时对象地址。 */
    private download(): void {
        const blob = new Blob([this.session.store.exportJSON('改动')], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = this.session.store.project.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_') + '-测试配置.json';
        // 下载产生的合成点击也必须留在面板事件边界内，避免传给游戏的全局点击监听。
        this.panel!.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.reportState('已发起改动 JSON 下载；若环境限制下载，可用导出改动复制文本');
    }

    /** 在面板内显示失败，保留现有游戏和上一份有效参数。 */
    private run(action: () => void): void {
        try { action(); } catch (error) { this.report(message(error)); }
    }

    /** 显示中文状态消息，保留换行便于阅读多个诊断。 */
    private report(text: string): void { if (this.status) this.status.textContent = text; }

    /** 提示待重启数量；保存目标值不表示运行中的实例已经更新。 */
    private reportState(text: string): void {
        const pending = this.session.store.snapshot().pendingRestart.length;
        this.report(text + (pending ? '\n有 ' + pending + ' 项等待重新启动游戏；刷新前先保存，或用复现链接打开。' : '\n当前无待重启参数。'));
    }
}
