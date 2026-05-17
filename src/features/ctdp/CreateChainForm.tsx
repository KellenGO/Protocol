import { useEffect, useState } from 'react';
import { createChain, getAppSettings } from '../../lib/db';
import type { Chain } from '../../types';

interface Props {
  onCreated: (chain: Chain) => void;
  onCancel: () => void;
}

export default function CreateChainForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [focusDuration, setFocusDuration] = useState(25);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getAppSettings().then((settings) => {
      const def = settings.find((s) => s.key === 'default_focus_duration');
      if (def) {
        const v = parseInt(def.value, 10);
        if (v > 0) setFocusDuration(v);
      }
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('链名称不能为空');
      return;
    }
    if (!Number.isInteger(focusDuration) || focusDuration < 1) {
      setError('专注时长必须为正整数');
      return;
    }

    setSubmitting(true);
    try {
      const chain = await createChain({
        name: name.trim(),
        description: description.trim(),
        focusDurationMinutes: focusDuration,
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

      <label className="form-field">
        <span>默认专注时长（分钟）</span>
        <input
          type="number"
          value={focusDuration}
          onChange={(e) => setFocusDuration(Number(e.target.value))}
          min={1}
        />
      </label>

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
