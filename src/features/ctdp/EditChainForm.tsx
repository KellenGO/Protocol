import { useState } from 'react';
import { updateChain } from '../../lib/db';
import type { Chain } from '../../types';
import {
  AUXILIARY_COMPLETION_TEMPLATES,
  AUXILIARY_TRIGGER_PRESETS,
  COMPLETION_CONDITION_TEMPLATES,
  MAIN_TRIGGER_PRESETS,
} from './protocolOptions';

interface Props {
  chain: Chain;
  onUpdated: (chain: Chain) => void;
  onCancel: () => void;
}

function initialPreset(value: string, presets: string[]): string {
  return presets.includes(value) ? value : '自定义';
}

export default function EditChainForm({ chain, onUpdated, onCancel }: Props) {
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description);
  const [triggerPreset, setTriggerPreset] = useState(initialPreset(chain.trigger_action, MAIN_TRIGGER_PRESETS));
  const [customTrigger, setCustomTrigger] = useState(
    MAIN_TRIGGER_PRESETS.includes(chain.trigger_action) ? '' : chain.trigger_action,
  );
  const [completionCondition, setCompletionCondition] = useState(
    chain.completion_condition || COMPLETION_CONDITION_TEMPLATES[0],
  );
  const [focusDuration, setFocusDuration] = useState(chain.focus_duration_minutes);
  const [auxiliaryTriggerPreset, setAuxiliaryTriggerPreset] = useState(
    initialPreset(chain.auxiliary_trigger_action, AUXILIARY_TRIGGER_PRESETS),
  );
  const [customAuxiliaryTrigger, setCustomAuxiliaryTrigger] = useState(
    AUXILIARY_TRIGGER_PRESETS.includes(chain.auxiliary_trigger_action)
      ? ''
      : chain.auxiliary_trigger_action,
  );
  const [auxiliaryDelay, setAuxiliaryDelay] = useState(chain.auxiliary_delay_minutes);
  const [auxiliaryCompletionCondition, setAuxiliaryCompletionCondition] = useState(
    chain.auxiliary_completion_condition || AUXILIARY_COMPLETION_TEMPLATES[0],
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function resolveTrigger(preset: string, custom: string): string {
    return preset === '自定义' ? custom.trim() : preset;
  }

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
      const updated = await updateChain(chain.id, {
        name: name.trim(),
        description: description.trim(),
        triggerAction,
        completionCondition: completionCondition.trim(),
        focusDurationMinutes: focusDuration,
        auxiliaryTriggerAction,
        auxiliaryDelayMinutes: auxiliaryDelay,
        auxiliaryCompletionCondition: auxiliaryCompletionCondition.trim(),
      });
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="chain-form" onSubmit={handleSubmit}>
      <h3>编辑主链</h3>

      <div className="form-section">
        <h4>基本信息</h4>
        <label className="form-field">
          <span>主链名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="form-field">
          <span>描述</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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

        {triggerPreset === '自定义' && (
          <label className="form-field">
            <span>自定义触发动作</span>
            <input value={customTrigger} onChange={(e) => setCustomTrigger(e.target.value)} />
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
          <textarea value={completionCondition} onChange={(e) => setCompletionCondition(e.target.value)} />
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

        {auxiliaryTriggerPreset === '自定义' && (
          <label className="form-field">
            <span>自定义辅助链触发动作</span>
            <input value={customAuxiliaryTrigger} onChange={(e) => setCustomAuxiliaryTrigger(e.target.value)} />
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
          <textarea value={auxiliaryCompletionCondition} onChange={(e) => setAuxiliaryCompletionCondition(e.target.value)} />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
      </div>
    </form>
  );
}
