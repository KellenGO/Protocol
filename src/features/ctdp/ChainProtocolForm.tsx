import { useEffect, useState } from 'react';
import {
  AUXILIARY_COMPLETION_TEMPLATES,
  AUXILIARY_TRIGGER_PRESETS,
  COMPLETION_CONDITION_TEMPLATES,
  MAIN_TRIGGER_PRESETS,
} from './protocolOptions';

const CUSTOM_PRESET = '自定义';

export interface ChainProtocolFormValues {
  name: string;
  description: string;
  triggerAction: string;
  completionCondition: string;
  focusDurationMinutes: number;
  auxiliaryTriggerAction: string;
  auxiliaryDelayMinutes: number;
  auxiliaryCompletionCondition: string;
}

interface Props {
  title: string;
  submitLabel: string;
  submittingLabel: string;
  initialValues: ChainProtocolFormValues;
  onSubmit: (values: ChainProtocolFormValues) => Promise<void>;
  onCancel: () => void;
}

function initialPreset(value: string, presets: string[]): string {
  return presets.includes(value) ? value : CUSTOM_PRESET;
}

function resolveTrigger(preset: string, custom: string): string {
  return preset === CUSTOM_PRESET ? custom.trim() : preset;
}

export default function ChainProtocolForm({
  title,
  submitLabel,
  submittingLabel,
  initialValues,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [triggerPreset, setTriggerPreset] = useState(initialPreset(initialValues.triggerAction, MAIN_TRIGGER_PRESETS));
  const [customTrigger, setCustomTrigger] = useState(
    MAIN_TRIGGER_PRESETS.includes(initialValues.triggerAction) ? '' : initialValues.triggerAction,
  );
  const [completionCondition, setCompletionCondition] = useState(initialValues.completionCondition);
  const [focusDuration, setFocusDuration] = useState(initialValues.focusDurationMinutes);
  const [auxiliaryTriggerPreset, setAuxiliaryTriggerPreset] = useState(
    initialPreset(initialValues.auxiliaryTriggerAction, AUXILIARY_TRIGGER_PRESETS),
  );
  const [customAuxiliaryTrigger, setCustomAuxiliaryTrigger] = useState(
    AUXILIARY_TRIGGER_PRESETS.includes(initialValues.auxiliaryTriggerAction)
      ? ''
      : initialValues.auxiliaryTriggerAction,
  );
  const [auxiliaryDelay, setAuxiliaryDelay] = useState(initialValues.auxiliaryDelayMinutes);
  const [auxiliaryCompletionCondition, setAuxiliaryCompletionCondition] = useState(
    initialValues.auxiliaryCompletionCondition,
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(initialValues.name);
    setDescription(initialValues.description);
    setTriggerPreset(initialPreset(initialValues.triggerAction, MAIN_TRIGGER_PRESETS));
    setCustomTrigger(MAIN_TRIGGER_PRESETS.includes(initialValues.triggerAction) ? '' : initialValues.triggerAction);
    setCompletionCondition(initialValues.completionCondition);
    setFocusDuration(initialValues.focusDurationMinutes);
    setAuxiliaryTriggerPreset(initialPreset(initialValues.auxiliaryTriggerAction, AUXILIARY_TRIGGER_PRESETS));
    setCustomAuxiliaryTrigger(
      AUXILIARY_TRIGGER_PRESETS.includes(initialValues.auxiliaryTriggerAction)
        ? ''
        : initialValues.auxiliaryTriggerAction,
    );
    setAuxiliaryDelay(initialValues.auxiliaryDelayMinutes);
    setAuxiliaryCompletionCondition(initialValues.auxiliaryCompletionCondition);
  }, [initialValues]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const triggerAction = resolveTrigger(triggerPreset, customTrigger);
    const auxiliaryTriggerAction = resolveTrigger(auxiliaryTriggerPreset, customAuxiliaryTrigger);

    if (!name.trim()) {
      setError('主链名称不能为空');
      return;
    }
    if (!triggerAction) {
      setError('触发动作不能为空');
      return;
    }
    if (!completionCondition.trim()) {
      setError('完成条件不能为空');
      return;
    }
    if (!Number.isInteger(focusDuration) || focusDuration < 1) {
      setError('专注时长必须为正整数');
      return;
    }
    if (!auxiliaryTriggerAction) {
      setError('辅助链触发动作不能为空');
      return;
    }
    if (!Number.isInteger(auxiliaryDelay) || auxiliaryDelay < 1) {
      setError('辅助链预约时间必须为正整数');
      return;
    }
    if (!auxiliaryCompletionCondition.trim()) {
      setError('辅助链完成条件不能为空');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        triggerAction,
        completionCondition: completionCondition.trim(),
        focusDurationMinutes: focusDuration,
        auxiliaryTriggerAction,
        auxiliaryDelayMinutes: auxiliaryDelay,
        auxiliaryCompletionCondition: auxiliaryCompletionCondition.trim(),
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="chain-form" onSubmit={handleSubmit}>
      <h3>{title}</h3>

      <div className="form-section">
        <h4>基本信息</h4>
        <label className="form-field">
          <span>主链名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：每日阅读"
            autoFocus
          />
        </label>

        <label className="form-field">
          <span>描述</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选：简短描述这条链的目标"
          />
        </label>
      </div>

      <div className="form-section">
        <h4>主链协议</h4>
        <label className="form-field">
          <span>触发动作（神圣座位）</span>
          <select className="form-select" value={triggerPreset} onChange={(e) => setTriggerPreset(e.target.value)}>
            {MAIN_TRIGGER_PRESETS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        {triggerPreset === CUSTOM_PRESET && (
          <label className="form-field">
            <span>自定义触发动作</span>
            <input
              value={customTrigger}
              onChange={(e) => setCustomTrigger(e.target.value)}
              placeholder="例如：深呼吸三次后戴上蓝色帽子"
            />
          </label>
        )}

        <label className="form-field">
          <span>持续时间（分钟）</span>
          <input
            type="number"
            value={focusDuration}
            onChange={(e) => setFocusDuration(Number(e.target.value))}
            min={1}
          />
        </label>

        <label className="form-field">
          <span>完成条件</span>
          <select className="form-select" value={completionCondition} onChange={(e) => setCompletionCondition(e.target.value)}>
            {COMPLETION_CONDITION_TEMPLATES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <textarea
            value={completionCondition}
            onChange={(e) => setCompletionCondition(e.target.value)}
            placeholder="描述这条主链如何算完成"
          />
        </label>
      </div>

      <div className="form-section">
        <h4>辅助链协议</h4>
        <label className="form-field">
          <span>辅助链触发动作</span>
          <select className="form-select" value={auxiliaryTriggerPreset} onChange={(e) => setAuxiliaryTriggerPreset(e.target.value)}>
            {AUXILIARY_TRIGGER_PRESETS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        {auxiliaryTriggerPreset === CUSTOM_PRESET && (
          <label className="form-field">
            <span>自定义辅助链触发动作</span>
            <input
              value={customAuxiliaryTrigger}
              onChange={(e) => setCustomAuxiliaryTrigger(e.target.value)}
              placeholder="例如：给自己发送一条预约消息"
            />
          </label>
        )}

        <label className="form-field">
          <span>预约时间（分钟）</span>
          <input
            type="number"
            value={auxiliaryDelay}
            onChange={(e) => setAuxiliaryDelay(Number(e.target.value))}
            min={1}
          />
        </label>

        <label className="form-field">
          <span>辅助链完成条件</span>
          <select className="form-select" value={auxiliaryCompletionCondition} onChange={(e) => setAuxiliaryCompletionCondition(e.target.value)}>
            {AUXILIARY_COMPLETION_TEMPLATES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <textarea
            value={auxiliaryCompletionCondition}
            onChange={(e) => setAuxiliaryCompletionCondition(e.target.value)}
            placeholder="描述辅助链如何算履约"
          />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? submittingLabel : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
      </div>
    </form>
  );
}
