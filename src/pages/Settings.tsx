import { useEffect, useState } from 'react';
import { getAppSettings, updateAppSetting } from '../lib/db';
import type { AppSetting } from '../types';

function getValue(settings: AppSetting[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? '';
}

export default function Settings() {
  const [loading, setLoading] = useState(true);

  const [focusDur, setFocusDur] = useState('');
  const [reservationDur, setReservationDur] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    getAppSettings()
      .then((s) => {
        setFocusDur(getValue(s, 'default_focus_duration'));
        setReservationDur(getValue(s, 'default_reservation_duration'));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function saveSetting(key: string, value: string) {
    const num = parseInt(value, 10);
    if (!Number.isInteger(num) || num < 1) {
      setError('时长必须为正整数');
      return;
    }
    setError('');
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      await updateAppSetting(key, String(num));
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  if (loading) {
    return (
      <div className="page">
        <h2>设置</h2>
        <p className="placeholder-text">加载中…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>设置</h2>

      {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="settings-list">
        <div className="settings-item">
          <div className="settings-item-info">
            <span className="settings-item-label">默认正式任务时长</span>
            <span className="settings-item-hint">
              新建主链时的默认专注时长（分钟）
            </span>
          </div>
          <div className="settings-item-control">
            <input
              type="number"
              className="settings-input"
              value={focusDur}
              onChange={(e) => setFocusDur(e.target.value)}
              min={1}
            />
            <button
              className="btn btn-secondary"
              disabled={saving['default_focus_duration']}
              onClick={() => saveSetting('default_focus_duration', focusDur)}
            >
              {saving['default_focus_duration'] ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <span className="settings-item-label">默认预约时长</span>
            <span className="settings-item-hint">
              新建预约时的默认延迟（分钟）
            </span>
          </div>
          <div className="settings-item-control">
            <input
              type="number"
              className="settings-input"
              value={reservationDur}
              onChange={(e) => setReservationDur(e.target.value)}
              min={1}
            />
            <button
              className="btn btn-secondary"
              disabled={saving['default_reservation_duration']}
              onClick={() => saveSetting('default_reservation_duration', reservationDur)}
            >
              {saving['default_reservation_duration'] ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <span className="settings-item-label">桌面通知</span>
            <span className="settings-item-hint">
              后续版本支持
            </span>
          </div>
          <span className="settings-value-muted">—</span>
        </div>
      </div>
    </div>
  );
}
