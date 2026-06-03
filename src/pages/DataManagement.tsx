import { useEffect, useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  getDatabaseInfo,
  backupDatabase,
  restoreDatabase,
  exportHistoryJson,
  cleanTestData,
} from '../lib/db';
import type { DatabaseInfo, CleanTestDataResult } from '../types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DataManagement() {
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  // Clean data confirmation state
  const [cleanStep, setCleanStep] = useState(0); // 0=idle, 1=first confirm, 2=final confirm
  const [cleanResult, setCleanResult] = useState<CleanTestDataResult | null>(null);

  // Restore confirmation
  const [restoreConfirmPath, setRestoreConfirmPath] = useState<string | null>(null);

  const clearMessages = () => {
    setError('');
    setSuccess('');
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
        return; // user cancelled
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

  const handleRestoreSelect = async () => {
    clearMessages();
    setRestoreConfirmPath(null);

    const selected = await open({
      multiple: false,
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
    });

    if (!selected) return;

    const filePath = typeof selected === 'string' ? selected : selected.path;
    setRestoreConfirmPath(filePath);
  };

  const handleRestoreConfirm = async () => {
    if (!restoreConfirmPath) return;
    clearMessages();
    setBusy(true);
    try {
      const result = await restoreDatabase(restoreConfirmPath);
      setSuccess(result);
      setRestoreConfirmPath(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

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

  const handleCleanStart = () => {
    clearMessages();
    setCleanStep(1);
  };

  const handleCleanCancel = () => {
    setCleanStep(0);
    setCleanResult(null);
  };

  const handleCleanConfirm = () => {
    if (cleanStep === 1) {
      setCleanStep(2);
    } else if (cleanStep === 2) {
      performClean();
    }
  };

  const performClean = async () => {
    setBusy(true);
    try {
      const result = await cleanTestData();
      setCleanResult(result);
      setCleanStep(0);
      setSuccess(
        `已清理 ${result.deleted_records} 条历史记录。保留: ${result.remaining.chains} 条主链, ${result.remaining.precedents} 条判例, ${result.remaining.rsip_formulas} 条定式。`,
      );
      await refreshInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2>数据管理</h2>
        <p className="placeholder-text">加载中...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>数据管理</h2>

      {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}
      {success && (
        <p className="dm-success" style={{ marginBottom: 16 }}>
          {success}
        </p>
      )}

      {/* Database Info */}
      <section className="dm-section">
        <h3>数据库信息</h3>
        {dbInfo && (
          <div className="dm-info-grid">
            <div className="dm-info-item">
              <span className="dm-info-label">路径</span>
              <span className="dm-info-value dm-info-path">{dbInfo.db_path}</span>
            </div>
            <div className="dm-info-item">
              <span className="dm-info-label">文件大小</span>
              <span className="dm-info-value">{formatFileSize(dbInfo.file_size_bytes)}</span>
            </div>
            <div className="dm-info-item">
              <span className="dm-info-label">数据库版本</span>
              <span className="dm-info-value">{dbInfo.version}</span>
            </div>
          </div>
        )}
        {dbInfo && (
          <div className="dm-table-counts">
            <span className="dm-table-count">
              主链 <strong>{dbInfo.tables.chains}</strong>
            </span>
            <span className="dm-table-count">
              专注记录 <strong>{dbInfo.tables.focus_sessions}</strong>
            </span>
            <span className="dm-table-count">
              预约记录 <strong>{dbInfo.tables.reservation_sessions}</strong>
            </span>
            <span className="dm-table-count">
              判例 <strong>{dbInfo.tables.precedents}</strong>
            </span>
            <span className="dm-table-count">
              定式 <strong>{dbInfo.tables.rsip_formulas}</strong>
            </span>
            <span className="dm-table-count">
              定式事件 <strong>{dbInfo.tables.formula_events}</strong>
            </span>
          </div>
        )}
        <button className="btn btn-secondary" onClick={refreshInfo} disabled={busy} style={{ marginTop: 12 }}>
          刷新信息
        </button>
      </section>

      {/* Backup */}
      <section className="dm-section">
        <h3>备份数据</h3>
        <p className="dm-desc">
          将当前 SQLite 数据库完整复制为一个备份文件。建议定期备份，保留到安全位置。
        </p>
        <button className="btn btn-primary" onClick={handleBackup} disabled={busy}>
          {busy ? '处理中...' : '备份当前数据'}
        </button>
      </section>

      {/* Restore */}
      <section className="dm-section">
        <h3>从备份恢复</h3>
        <p className="dm-desc">
          选择一个 Protocol 备份文件（.sqlite）来替换当前数据。
          恢复前会自动创建当前数据的安全备份，存放在数据库目录的 <code>.backup/</code> 子目录下。
        </p>
        <p className="dm-warn">
          ⚠️ 恢复会替换当前所有本地数据。请确认已备份当前数据。
        </p>

        {restoreConfirmPath ? (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text">
              确认要从以下文件恢复数据？
            </p>
            <p className="dm-confirm-path">{restoreConfirmPath}</p>
            <p className="dm-confirm-warn">
              此操作不可撤销！当前数据将被完全替换。恢复后需要重启应用。
            </p>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setRestoreConfirmPath(null)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger-outline" onClick={handleRestoreConfirm} disabled={busy}>
                {busy ? '恢复中...' : '确认恢复'}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={handleRestoreSelect} disabled={busy}>
            选择备份文件...
          </button>
        )}
      </section>

      {/* Export */}
      <section className="dm-section">
        <h3>导出历史数据</h3>
        <p className="dm-desc">
          将协议历史导出为 JSON 格式，包含：主链配置、专注记录、预约记录、判例、定式事件。可用于数据迁移或外部查看。
        </p>
        <button className="btn btn-primary" onClick={handleExport} disabled={busy}>
          {busy ? '导出中...' : '导出为 JSON'}
        </button>
      </section>

      {/* Archive Note */}
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
          <p style={{ marginTop: 8 }}>
            建议优先将不再使用的链归档、将不适用的判例废止，而非直接删除。这样可以保留完整的历史关联。
          </p>
        </div>
      </section>

      {/* Clean Test Data */}
      <section className="dm-section dm-section-danger">
        <h3>清理历史数据</h3>
        <p className="dm-desc">
          删除所有专注记录、预约记录和定式事件，重置所有链的计数。
          <strong>保留</strong>主链配置、判例库、定式树和应用设置不变。
        </p>
        <p className="dm-warn">
          ⚠️ 此操作为<strong>不可逆</strong>的危险操作。清理前请先备份数据。
        </p>

        {cleanResult && (
          <div className="dm-clean-result">
            已清理 <strong>{cleanResult.deleted_records}</strong> 条记录。
            保留: {cleanResult.remaining.chains} 主链, {cleanResult.remaining.precedents} 判例, {cleanResult.remaining.rsip_formulas} 定式。
          </div>
        )}

        {cleanStep === 0 && (
          <button className="btn btn-danger-outline" onClick={handleCleanStart} disabled={busy}>
            {busy ? '清理中...' : '清理历史数据...'}
          </button>
        )}

        {cleanStep === 1 && (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text">
              确认要清理所有历史数据？（第 1/2 步确认）
            </p>
            <p className="dm-confirm-detail">
              将删除所有专注记录、预约记录、定式事件，并重置链计数。
              主链、判例、定式树和应用设置将保留。
            </p>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={handleCleanCancel} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger-outline" onClick={handleCleanConfirm} disabled={busy}>
                继续确认
              </button>
            </div>
          </div>
        )}

        {cleanStep === 2 && (
          <div className="dm-confirm-box">
            <p className="dm-confirm-text dm-confirm-final">
              ⚠️ 最终确认：此操作不可撤销！
            </p>
            <p className="dm-confirm-detail">
              请确认已备份当前数据。点击"执行清理"后将立即删除所有历史记录。
            </p>
            <div className="dm-confirm-actions">
              <button className="btn btn-secondary" onClick={handleCleanCancel} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger-outline" onClick={handleCleanConfirm} disabled={busy}>
                {busy ? '清理中...' : '执行清理'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
