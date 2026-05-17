import { useState } from 'react';
import { updateChain } from '../../lib/db';
import type { Chain } from '../../types';

interface Props {
  chain: Chain;
  onUpdated: (chain: Chain) => void;
  onCancel: () => void;
}

export default function EditChainForm({ chain, onUpdated, onCancel }: Props) {
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description);
  const [focusDuration, setFocusDuration] = useState(chain.focus_duration_minutes);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('主链名称不能为空');
      return;
    }
    if (!Number.isInteger(focusDuration) || focusDuration < 1) {
      setError('专注时长必须为正整数');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateChain(chain.id, {
        name: name.trim(),
        description: description.trim(),
        focusDurationMinutes: focusDuration,
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
          {submitting ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
      </div>
    </form>
  );
}
