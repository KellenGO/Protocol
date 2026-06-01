import { useEffect, useState } from 'react';
import { createChain, getAppSettings } from '../../lib/db';
import type { Chain } from '../../types';
import {
  AUXILIARY_COMPLETION_TEMPLATES,
  AUXILIARY_TRIGGER_PRESETS,
  COMPLETION_CONDITION_TEMPLATES,
  MAIN_TRIGGER_PRESETS,
} from './protocolOptions';

interface Props {
  onCreated: (chain: Chain) => void;
  onCancel: () => void;
}

export default function CreateChainForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerPreset, setTriggerPreset] = useState(MAIN_TRIGGER_PRESETS[0]);
  const [customTrigger, setCustomTrigger] = useState('');
  const [completionCondition, setCompletionCondition] = useState(COMPLETION_CONDITION_TEMPLATES[0]);
  const [focusDuration, setFocusDuration] = useState(25);
  const [auxiliaryTriggerPreset, setAuxiliaryTriggerPreset] = useState(AUXILIARY_TRIGGER_PRESETS[0]);
  const [customAuxiliaryTrigger, setCustomAuxiliaryTrigger] = useState('');
  const [auxiliaryDelay, setAuxiliaryDelay] = useState(15);
  const [auxiliaryCompletionCondition, setAuxiliaryCompletionCondition] = useState(AUXILIARY_COMPLETION_TEMPLATES[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getAppSettings().then((settings) => {
      const def = settings.find((s) => s.key === 'default_focus_duration');
      if (def) {
        const v = parseInt(def.value, 10);
        if (v > 0) setFocusDuration(v);
      }
      const resDef = settings.find((s) => s.key === 'default_reservation_duration');
      if (resDef) {
        const v = parseInt(resDef.value, 10);
        if (v > 0) setAuxiliaryDelay(v);
      }
    }).catch(() => {});
  }, []);

  function resolveTrigger(preset: string, custom: string): string {
    return preset === '自定义' ? custom.trim() : preset;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('链名称不能为空');
      return;
    }
    const triggerAction = resolveTrigger(triggerPreset, customTrigger);
    const auxiliaryTriggerAction = resolveTrigger(auxiliaryTriggerPreset, customAuxiliaryTrigger);
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
      const chain = await createChain({
        name: name.trim(),
        description: description.trim(),
        triggerAction,
        completionCondition: completionCondition.trim(),
        focusDurationMinutes: focusDuration,
        auxiliaryTriggerAction,
        auxiliaryDelayMinutes: auxiliaryDelay,
        auxiliaryCompletionCondition: auxiliaryCompletionCondition.trim(),
      });
      onCreated(chain);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="chain-form" onSubmit={handleSubmit}>
      <h3>新建主链</h3>

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

        {triggerPreset === '自定义' && (
          <label className="form-field">
            <span>自定义触发动作</span>
            <input value={customTrigger} onChange={(e) => setCustomTrigger(e.target.value)} placeholder="例如：深呼吸三次后戴上蓝色帽子" />
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

        {auxiliaryTriggerPreset === '自定义' && (
          <label className="form-field">
            <span>自定义辅助链触发动作</span>
            <input value={customAuxiliaryTrigger} onChange={(e) => setCustomAuxiliaryTrigger(e.target.value)} placeholder="例如：给自己发送一条预约消息" />
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
          {submitting ? '创建中…' : '创建'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
      </div>
    </form>
  );
}
