'use client';

import { useEffect, useState } from 'react';

type AuditLog = {
  id: string;
  itemId: string | null;
  action: string;
  result: string | null;
  reviewer: string;
  isImportant: boolean;
  createdAt: string;
  item?: {
    title: string;
    url?: string;
    canonicalUrl?: string;
  } | null;
  reason?: string | null;
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState('');
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (result) params.set('result', result);
    if (onlyImportant) params.set('important', 'true');
    const res = await fetch('/api/audit-logs?' + params.toString());
    const data = await res.json();
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleExport = (format: 'xlsx' | 'pdf') => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (result) params.set('result', result);
    if (onlyImportant) params.set('important', 'true');
    params.set('format', format);
    const url = '/api/audit-logs/export?' + params.toString();
    window.open(url, '_blank');
  };

  const handleCleanup = async () => {
    if (!confirm('确定要清理 30 天前的普通审核记录吗？')) return;
    await fetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cleanup' }),
    });
    fetchLogs();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">审核记录</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('xlsx')}
            className="px-3 py-2 bg-blue-600 text-white text-sm rounded"
          >
            导出 Excel
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="px-3 py-2 bg-indigo-600 text-white text-sm rounded"
          >
            导出 PDF
          </button>
          <button
            onClick={handleCleanup}
            className="px-3 py-2 bg-red-600 text-white text-sm rounded"
          >
            清理 30 天前记录
          </button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg mb-6 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">开始日期</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">结束日期</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">审核结果</label>
            <select
              value={result}
              onChange={e => setResult(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
            >
              <option value="">全部</option>
              <option value="APPROVED">通过</option>
              <option value="REJECTED">拒绝</option>
              <option value="DIGEST_UPDATED">仅修改摘要</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center text-sm">
              <input
                type="checkbox"
                checked={onlyImportant}
                onChange={e => setOnlyImportant(e.target.checked)}
                className="mr-2"
              />
              仅显示重要记录
            </label>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={fetchLogs}
            className="px-4 py-2 bg-gray-800 text-white text-sm rounded"
          >
            查询
          </button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">暂无审核记录</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  时间
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  标题/URL
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  结果
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  原因
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  审核人
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  重要
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  查看内容
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.map(log => (
                <tr key={log.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">
                    <div title={log.item?.title}>{log.item?.title || '-'}</div>
                    <div className="text-xs text-gray-400 truncate" title={log.item?.canonicalUrl || log.item?.url}>
                      {log.item?.canonicalUrl || log.item?.url || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {log.action === 'STATUS_CHANGE' ? '状态变更' : 
                     log.action === 'DIGEST_UPDATE' ? '摘要更新' : 
                     log.action === 'PUSH_WECOM' ? '推送企微' : log.action}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {log.result === 'APPROVED' ? <span className="text-green-600">通过</span> :
                     log.result === 'REJECTED' ? <span className="text-red-600">拒绝</span> :
                     log.result === 'DIGEST_UPDATED' ? '摘要已更新' :
                     log.result === 'PUSHED' ? <span className="text-green-600">推送成功</span> :
                     log.result === 'SKIP_PER_TASK_LIMIT' ? <span className="text-yellow-600">单次限流</span> :
                     log.result === 'SKIP_PER_SOURCE_WINDOW' ? <span className="text-yellow-600">窗口限流</span> :
                     log.result === 'DOWNGRADED_BIG_BATCH' ? <span className="text-orange-600">大批量降级</span> :
                     log.result || '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500 max-w-xs truncate" title={log.reason || ''}>
                    {log.reason || '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">{log.reviewer}</td>
                  <td className="px-4 py-2 text-sm">
                    {log.isImportant ? (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">
                        是
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                        否
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm font-medium">
                    {log.itemId ? (
                      <a href={`/items/${log.itemId}`} className="text-blue-600 hover:text-blue-900 hover:underline">
                        查看详情
                      </a>
                    ) : (
                      <span className="text-gray-400">无链接</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

