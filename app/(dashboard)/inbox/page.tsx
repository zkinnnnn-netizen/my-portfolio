/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Item = {
  id: string;
  title: string;
  source: { name: string };
  publishedAt: string;
  status: string;
  url: string;
  createdAt: string;
  pushedAt: string | null;
  skipReason: string | null;
};

export default function InboxPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
   const [statusFilter, setStatusFilter] = useState<string>('ALL');
   const [hours, setHours] = useState<number>(24);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string; status?: number } | null>(null);
   const router = useRouter();

  useEffect(() => {
    fetchItems();
  }, [statusFilter, hours]);

  const fetchItems = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (hours) params.set('hours', String(hours));
    const res = await fetch('/api/items?' + params.toString());
    const data = await res.json();
    setItems(data);
    setLoading(false);
  };

  const triggerIngest = async () => {
    if (!confirm('确定要立即触发抓取吗？这可能需要一些时间。')) return;
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch('/api/ingest', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setToast({
          type: 'error',
          status: res.status,
          message: `抓取失败 (HTTP ${res.status})：${data?.error || res.statusText || '未知错误'}`,
        });
      } else {
        const stats = data?.stats || {};
        const msg = [
          `新增 ${stats.upserted || 0} 条`,
          `推送 ${stats.pushed || 0} 条`,
          `跳过(Dedup) ${stats.dedupSkipped || 0} 条`,
          `过旧未推送 ${stats.skippedTooOld || 0} 条`,
          `错误 ${stats.errors || 0} 条`,
        ].join('，');
        setToast({
          type: 'success',
          status: res.status,
          message: `抓取成功 (HTTP ${res.status})：${msg}`,
        });
      }
    } catch (e) {
      console.error(e);
      setToast({
        type: 'error',
        message: '触发抓取请求失败（可能是超时），后台可能仍在运行，请稍后刷新查看。',
      });
    } finally {
      setLoading(false);
      fetchItems();
    }
  };

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded shadow text-sm text-white ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          <div className="font-semibold">
            {toast.type === 'success' ? '抓取成功' : '抓取失败'}
            {typeof toast.status === 'number' ? ` · HTTP ${toast.status}` : ''}
          </div>
          <div className="mt-1">{toast.message}</div>
          <button
            className="mt-2 text-xs underline text-white/80"
            onClick={() => setToast(null)}
          >
            关闭
          </button>
        </div>
      )}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">收件箱 (Inbox)</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="ALL">全部</option>
              <option value="PENDING">待处理</option>
              <option value="APPROVED">已通过</option>
              <option value="REJECTED">已拒绝</option>
              <option value="SKIPPED">已跳过</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>时间范围</span>
            <select
              value={hours}
              onChange={e => setHours(parseInt(e.target.value, 10))}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value={6}>近 6 小时</option>
              <option value={24}>近 24 小时</option>
              <option value={72}>近 3 天</option>
            </select>
          </div>
          <button
            onClick={triggerIngest}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            立即抓取
          </button>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-gray-500">近一段时间内没有任何条目</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">来源</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">链接</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">已推送时间</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">跳过原因</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-700">{item.source.name}</td>
                  <td className="px-4 py-2 max-w-xs">
                    <Link href={`/items/${item.id}`} className="hover:text-blue-600 font-medium">
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 max-w-xs">
                    <a href={item.url} target="_blank" className="text-blue-600 hover:underline">
                      原文 ↗
                    </a>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        item.status === 'PENDING'
                          ? 'bg-yellow-100 text-yellow-800'
                          : item.status === 'APPROVED'
                          ? 'bg-green-100 text-green-800'
                          : item.status === 'REJECTED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {item.pushedAt ? new Date(item.pushedAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2 max-w-xs text-gray-500">
                    {item.skipReason || '-'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link
                      href={`/items/${item.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      查看
                    </Link>
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
