import { useEffect, useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  getDatabaseInfo,
  backupDatabase,
  restoreDatabase,
  inspectBackupFile,
  exportHistoryJson,
  resetHistoryAndProgress,
} from '../lib/db';
import type { BackupFileInfo, DatabaseInfo, ResetHistoryResult } from '../types';

const RESET_CONFIRM_TEXT = '重置历史';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isNumber(v: number | string): v is number {
  return typeof v === 'number';
}

export default function DataManagement() {
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  // Restore flow
  const [backupInfo, setBackupInfo] = useState<BackupFileInfo | null>(null);
  const [restoreError, setRestoreError] = useState('');

  // Reset flow
  const [resetStep, setResetStep] = useState(0); // 0=idle, 1=confirm, 2=input text
  const [resetInput, setResetInput] = useState('');
  const [resetResult, setResetResult] = useState<ResetHistoryResult | null>(null);

  const clearMessages = () => {
    setError('');
    setSuccess('');
    setRestoreError('');
  };

  const refreshInfo = async () => {
    try {
      const info = await getDatabaseInfo();
      setDbInfo(info);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    refreshInfo().finally(() => setLoading(false));
  }, []);

  const handleBackup = async () => {
    clearMessages();
    setBusy(true);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const defaultName = `protocol-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.sqlite`;

      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
      });

      if (!filePath) {
        setBusy(false);
        return;
      }

      const result = await backupDatabase(filePath);
      setSuccess(`备份已保存到: ${result}`);
      await refreshInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // ---- Restore flow ----

  const handleRestoreSelect = async () => {
    clearMessages();
    setBackupInfo(null);

    const selected = await open({
      multiple: false,
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
    });

    if (!selected) return;

    const filePath = selected;

    // Inspect the backup file before showing confirm UI
    setBusy(true);
    try {
      const info = await inspectBackupFile(filePath);
      setBackupInfo(info);
    } catch (err) {
      setRestoreError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreCancel = () => {
    setBackupInfo(null);
  };

  const handleRestoreConfirm = async () => {
    if (!backupInfo) return;
    clearMessages();
    setBusy(true);
    try {
      const result = await restoreDatabase(backupInfo.path);
      setBackupInfo(null);
      setSuccess(result);
      try {
        const info = await getDatabaseInfo();
        setDbInfo(info);
      } catch (refreshErr) {
        setDbInfo(null);
        setError(`恢复已成功，但统计刷新失败: ${String(refreshErr)}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // ---- Export ----

  const handleExport = async () => {
    clearMessages();
    setBusy(true);
    try {
      const data = await exportHistoryJson();

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const defaultName = `protocol-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;

      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });

      if (!filePath) {
        setBusy(false);
        return;
      }

      await invoke('save_export_file', {
        path: filePath,
        content: JSON.stringify(data, null, 2),
      });
      setSuccess(`历史数据已导出到: ${filePath}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // ---- Reset flow ----

  const handleResetStart = () => {
    clearMessages();
    setResetStep(1);
    setResetInput('');
  };

  const handleResetCancel = () => {
    setResetStep(0);
    setResetInput('');
    setResetResult(null);
  };

  const handleResetAdvance = () => {
    if (resetStep === 1) {
      setResetStep(2);
    }
  };

  const handleResetExecute = () => {
    if (resetInput.trim() === RESET_CONFIRM_TEXT) {
      performReset();
    }
  };

  const performReset = async () => {
    setBusy(true);
    try {
      const result = await resetHistoryAndProgress();
      setResetResult(result);
      setResetStep(0);
      setResetInput('');
      setSuccess(
        `已重置 ${result.deleted_records} 条历史记录，所有链进度已归零。保留: ${result.remaining.chains} 条主链, ${result.remaining.precedents} 条判例, ${result.remaining.rsip_formulas} 条定式。`,
      );
      await refreshInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // ---- Helpers ----

  const renderTableCount = (label: string, count: number | string) => {
    if (isNumber(count)) {
      return (
        <span className="dm-table-count">
          {label} <strong>{count}</strong>
        </span>
      );
    }
    return (
      <span className="dm-table-count dm-table-missing">
        {label} <strong>{count}</strong>
      </span>
    );
  };

  // ---- Loading ----

  if (loading) {
    return (
      <div className="page dm-page">
        <div className="page-header">
          <div className="page-title-block">
            <h2>数据管理</h2>
            <p className="page-subtitle">管理本地数据库、备份、恢复和历史导出。</p>
          </div>
        </div>
        <div className="review-loading">
          <p className="placeholder-text">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page dm-page">
      <div className="page-header">
        <div className="page-title-block">
          <h2>数据管理</h2>
          <p className="page-subtitle">Protocol 的本地数据只在离线数据库中流转；这里负责备份、恢复和导出。</p>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {success && (
        <p className="dm-success" role="status" aria-live="polite">
          {success}
        </p>
      )}

      {/* ===== Database Info ===== */}
      <section className="dm-section">
        <h3>数据库信息</h3>
        {dbInfo && (
          <div className="dm-info-layout">
            <div className="dm-path-panel">
              <span className="dm-info-label">数据库路径</span>
              <code className="code-path">{dbInfo.db_path}</code>
            </div>

            <div className="dm-info-grid">
              <div className="dm-stat">
                <span className="dm-stat-label">文件大小</span>
                <strong className="dm-stat-value">{formatFileSize(dbInfo.file_size_bytes)}</strong>
              </div>
              <div className="dm-stat">
                <span className="dm-stat-label">数据库版本</span>
                <strong className="dm-stat-value">{dbInfo.version}</strong>
              </div>
            </div>

            <div className="dm-table-counts">
              {renderTableCount('主链', dbInfo.tables.chains)}
              {renderTableCount('专注记录', dbInfo.tables.focus_sessions)}
              {renderTableCount('预约记录', dbInfo.tables.reservation_sessions)}
              {renderTableCount('判例', dbInfo.tables.precedents)}
              {renderTableCount('定式', dbInfo.tables.rsip_formulas)}
              {renderTableCount('定式事件', dbInfo.tables.formula_events)}
            </div>

            <div className="dm-section-actions">
              <button className="btn btn-secondary" onClick={refreshInfo} disabled={busy}>
                刷新信息
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ===== Backup ===== */}
      <section className="dm-section">
        <h3>备份数据</h3>
        <p className="dm-desc">
          将当前 SQLite 数据库完整复制为一个备份文件。建议定期备份，保留到安全位置。
        </p>
        <div className="dm-section-actions">
          <button className="btn btn-primary" onClick={handleBackup} disabled={busy}>
            {busy ? '处理中...' : '备份当前数据'}
          </button>
        </div>
      </section>

      {/* ===== Restore ===== */}
      <section className="dm-section">
        <h3>从备份恢复</h3>
        <p className="dm-desc">
          恢复会替换当前所有本地数据，包括链进度、设置，以及备份中仍在进行或已经逾期的会话。恢复前会自动创建并验证当前数据库的安全快照；恢复成功后立即生效，无需重启 Protocol。
          请选择由 Protocol“备份当前数据”生成的自包含 SQLite 文件；正在使用的 protocol.db 或 WAL sidecar 组合不会被当作备份恢复。
        </p>
        <p className="dm-warn">
          恢复会替换当前所有本地数据。请确认已备份当前数据库。
        </p>

        {restoreError && (
          <p className="form-error" role="alert">{restoreError}</p>
        )}

        {/* Backup file info — after inspection */}
        {backupInfo ? (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text">备份文件信息</p>
            <div className="dm-backup-info-grid">
              <div className="dm-backup-info-item">
                <span>文件路径</span>
                <code className="code-path">{backupInfo.path}</code>
              </div>
              <div className="dm-backup-info-item">
                <span>文件大小</span>
                <strong>{formatFileSize(backupInfo.file_size_bytes)}</strong>
              </div>
              <div className="dm-backup-info-item">
                <span>数据库版本</span>
                <strong>{backupInfo.version}</strong>
              </div>
            </div>
            <div className="dm-table-counts">
              {renderTableCount('主链', backupInfo.tables.chains)}
              {renderTableCount('专注记录', backupInfo.tables.focus_sessions)}
              {renderTableCount('预约记录', backupInfo.tables.reservation_sessions)}
              {renderTableCount('判例', backupInfo.tables.precedents)}
              {renderTableCount('定式', backupInfo.tables.rsip_formulas)}
              {renderTableCount('定式事件', backupInfo.tables.formula_events)}
            </div>
            <p className="dm-confirm-warn">
              当前数据将被完整替换。确认后应用会立即切换到备份数据。
            </p>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={handleRestoreCancel} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger" onClick={handleRestoreConfirm} disabled={busy}>
                {busy ? '恢复中...' : '确认恢复'}
              </button>
            </div>
          </div>
        ) : (
          <div className="dm-section-actions">
            <button className="btn btn-secondary" onClick={handleRestoreSelect} disabled={busy}>
              选择备份文件...
            </button>
          </div>
        )}
      </section>

      {/* ===== Export ===== */}
      <section className="dm-section">
        <h3>导出历史数据</h3>
        <p className="dm-desc">
          将协议历史导出为 JSON 格式，包含：主链配置、专注记录、预约记录、判例、定式事件、应用设置。
          同时记录数据库版本和 Protocol 版本，可用于数据迁移或外部查看。
        </p>
        <div className="dm-section-actions">
          <button className="btn btn-secondary" onClick={handleExport} disabled={busy}>
            {busy ? '导出中...' : '导出为 JSON'}
          </button>
        </div>
      </section>

      {/* ===== Archive Note ===== */}
      <section className="dm-section">
        <h3>归档说明</h3>
        <div className="dm-note-box">
          <p>
            Protocol 优先采用<strong>归档/废止</strong>而非硬删除：
          </p>
          <ul>
            <li>主链支持 <code>active</code> / <code>archived</code> 状态切换</li>
            <li>判例支持 <code>active</code> / <code>retired</code> 状态切换（已废止判例不会在协议边界中展示）</li>
            <li>RSIP 定式支持点亮 (<code>active</code>) 与熄灭 (<code>inactive</code>) 状态切换</li>
          </ul>
          <p className="dm-note-foot">
            建议优先将不再使用的链归档、将不适用的判例废止，而非直接删除。这样可以保留完整的历史关联。
          </p>
        </div>
      </section>

      {/* ===== Reset History & Progress ===== */}
      <section className="dm-section dm-section-danger">
        <h3>重置历史与链进度</h3>
        <p className="dm-desc">
          删除所有专注记录、预约记录和定式事件，<strong>将所有链的当前长度与最佳长度归零</strong>。
          <strong>保留</strong>主链配置、判例库、定式树和应用设置不变。
        </p>
        <p className="dm-warn">
          此操作为<strong>不可逆</strong>的危险操作。执行前请先备份数据。
          链进度一旦归零无法恢复。
        </p>

        {resetResult && (
          <div className="dm-clean-result">
            已重置 <strong>{resetResult.deleted_records}</strong> 条记录。
            保留: {resetResult.remaining.chains} 主链, {resetResult.remaining.precedents} 判例, {resetResult.remaining.rsip_formulas} 定式。
          </div>
        )}

        {resetStep === 0 && (
          <div className="dm-section-actions">
            <button className="btn btn-danger" onClick={handleResetStart} disabled={busy}>
              {busy ? '处理中...' : '重置历史与链进度...'}
            </button>
          </div>
        )}

        {resetStep === 1 && (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text">
              确认要重置所有历史与链进度？
            </p>
            <p className="dm-confirm-detail">
              将删除所有专注记录、预约记录、定式事件，并将所有链的当前长度和最佳长度归零。
              主链配置、判例库、定式树和应用设置将保留不变。
              此操作不可撤销。
            </p>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={handleResetCancel} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger" onClick={handleResetAdvance} disabled={busy}>
                继续
              </button>
            </div>
          </div>
        )}

        {resetStep === 2 && (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text dm-confirm-final">
              最终确认：输入"{RESET_CONFIRM_TEXT}"后点击执行
            </p>
            <p className="dm-confirm-detail">
              请在下方输入框中输入 <strong>"{RESET_CONFIRM_TEXT}"</strong> 以确认此操作。
              此操作将立即执行，不可撤销。
            </p>
            <div className="dm-reset-input-row">
              <input
                type="text"
                className="settings-input dm-reset-input"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                placeholder={`输入"${RESET_CONFIRM_TEXT}"`}
                disabled={busy}
              />
            </div>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={handleResetCancel} disabled={busy}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={handleResetExecute}
                disabled={busy || resetInput.trim() !== RESET_CONFIRM_TEXT}
              >
                {busy ? '执行中...' : '执行重置'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
