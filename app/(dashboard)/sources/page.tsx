/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @next/next/no-html-link-for-pages */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

type Source = {
  id: string;
  name: string;
  type: string;
  url: string;
  regionTag: string;
  categoryTag: string;
  priority: number;
  isActive: boolean;
  fetchIntervalMinutes: number;
  lastFetchedAt?: string | null;
  lastError?: string | null;
  lastRunStats?: string | null;
  stats?: {
    fetched: number;
    upserted: number;
    pushed: number;
    dedupSkipped: number;
    skippedByLimit: number;
    skippedTooOld: number;
    errors: number;
  } | null;
};

type UploadFileState = {
  file: File;
  status: 'idle' | 'uploading' | 'success' | 'error';
  error?: string;
};

const ANTI_BOT_PREFIX = 'AntiBotBlocked:';
const ANTI_BOT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function getAntiBotCooldown(lastError?: string | null) {
  if (!lastError) return null;
  if (!lastError.includes(ANTI_BOT_PREFIX)) return null;
  const idx = lastError.lastIndexOf(' at ');
  if (idx === -1) return null;
  const ts = lastError.substring(idx + 4).trim();
  const blockedAt = new Date(ts);
  if (Number.isNaN(blockedAt.getTime())) return null;
  const until = new Date(blockedAt.getTime() + ANTI_BOT_COOLDOWN_MS);
  const now = new Date();
  if (now >= until) return null;
  const remainingMs = until.getTime() - now.getTime();
  return { blockedAt, until, remainingMs };
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Source>>({
    type: 'RSS',
    priority: 3,
    isActive: true,
    fetchIntervalMinutes: 60,
  });
  const [uploadFiles, setUploadFiles] = useState<UploadFileState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{ total: number; success: number; failed: number }>({
    total: 0,
    success: 0,
    failed: 0,
  });
  
  const router = useRouter();

  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async () => {
    const res = await fetch('/api/sources');
    const data = await res.json();
    setSources(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    setIsModalOpen(false);
    setFormData({ type: 'RSS', priority: 3, isActive: true, fetchIntervalMinutes: 60 });
    fetchSources();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除吗？')) return;
    await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    fetchSources();
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(sources.map(s => s.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个数据源吗？此操作不可恢复。`)) return;

    try {
      const res = await fetch('/api/sources/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '批量删除失败');
      
      setSelectedIds(new Set());
      fetchSources();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleStatus = async (source: Source) => {
    await fetch(`/api/sources/${source.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !source.isActive }),
    });
    fetchSources();
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const maxSize = 50 * 1024 * 1024;
    const states: UploadFileState[] = files.map(file => {
      if (file.size > maxSize) {
        return { file, status: 'error', error: '文件超过 50MB 限制' };
      }
      return { file, status: 'idle' };
    });
    setUploadFiles(states);
    setUploadSummary({
      total: states.length,
      success: 0,
      failed: states.filter(s => s.status === 'error').length,
    });
  };

  const parseJsonFile = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any).sources)) return (data as any).sources;
    return [];
  };

  const parseCsvFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1);
    const result: any[] = [];
    for (const line of rows) {
      const cols = line.split(',');
      const obj: any = {};
      header.forEach((key, index) => {
        obj[key] = cols[index] !== undefined ? cols[index].trim() : '';
      });
      result.push(obj);
    }
    return result;
  };

  const parseExcelFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet);
  };

  const buildSourcesFromRows = (rows: any[]) => {
    return rows
      .map(row => {
        const name = row.name || row.名称;
        const type = row.type || row.类型;
        const url = row.url || row.URL || row.link;
        if (!name || !type || !url) return null;
        const priority = row.priority || row.优先级 || 3;
        return {
          name: String(name),
          type: String(type).toUpperCase(),
          url: String(url),
          regionTag: row.regionTag || row.地区标签 || null,
          categoryTag: row.categoryTag || row.分类标签 || null,
          priority: typeof priority === 'string' ? parseInt(priority, 10) : priority,
          isActive: row.isActive !== undefined ? Boolean(row.isActive) : true,
        };
      })
      .filter(Boolean);
  };

  const uploadSingleFile = async (index: number) => {
    const current = uploadFiles[index];
    if (!current || current.status === 'uploading') return;
    if (current.status === 'error' && current.error === '文件超过 50MB 限制') return;

    const updated = [...uploadFiles];
    updated[index] = { ...current, status: 'uploading', error: undefined };
    setUploadFiles(updated);

    try {
      const file = current.file;
      const name = file.name.toLowerCase();
      let rows: any[] = [];

      if (name.endsWith('.json')) {
        rows = await parseJsonFile(file);
      } else if (name.endsWith('.csv')) {
        rows = await parseCsvFile(file);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        rows = await parseExcelFile(file);
      } else {
        throw new Error('不支持的文件格式');
      }

      const sources = buildSourcesFromRows(rows);
      if (!sources.length) {
        throw new Error('未解析出有效数据');
      }

      const res = await fetch('/api/sources/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '上传失败');
      }

      const updatedFiles = [...uploadFiles];
      updatedFiles[index] = { ...current, status: 'success' };
      setUploadFiles(updatedFiles);
      setUploadSummary(prev => ({
        total: prev.total,
        success: prev.success + 1,
        failed: prev.failed,
      }));
      fetchSources();
    } catch (e: any) {
      const updatedFiles = [...uploadFiles];
      updatedFiles[index] = { ...current, status: 'error', error: e.message || '上传失败' };
      setUploadFiles(updatedFiles);
      setUploadSummary(prev => ({
        total: prev.total,
        success: prev.success,
        failed: prev.failed + 1,
      }));
    }
  };

  const startUploadAll = async () => {
    if (!uploadFiles.length) return;
    setIsUploading(true);
    setUploadSummary({
      total: uploadFiles.length,
      success: 0,
      failed: uploadFiles.filter(f => f.status === 'error').length,
    });
    for (let i = 0; i < uploadFiles.length; i++) {
      await uploadSingleFile(i);
    }
    setIsUploading(false);
  };

  const sourcesWithErrors = sources.filter(s => s.stats && (s.stats.errors || 0) > 0);
  const topErrorSources = [...sourcesWithErrors].sort((a, b) => {
    const ea = a.stats ? a.stats.errors || 0 : 0;
    const eb = b.stats ? b.stats.errors || 0 : 0;
    return eb - ea;
  }).slice(0, 5);

  const scrollToSource = (id: string) => {
    const el = document.getElementById(`source-row-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">数据源管理</h1>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700"
              >
                批量删除 ({selectedIds.size})
              </button>
            )}
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800"
          >
            添加数据源
          </button>
        </div>

        {topErrorSources.length > 0 && (
          <div className="mb-4 bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-red-600">Errors Top 5</div>
              <div className="text-xs text-gray-500">按最近运行 errors 倒序</div>
            </div>
            <div className="space-y-1">
              {topErrorSources.map(source => (
                <button
                  key={source.id}
                  onClick={() => scrollToSource(source.id)}
                  className="w-full flex items-center justify-between text-left text-sm px-2 py-1 rounded hover:bg-red-50"
                >
                  <span className="truncate max-w-xs">{source.name}</span>
                  <span className="ml-2 text-xs text-red-600">
                    errors: {source.stats ? source.stats.errors || 0 : 0}
                  </span>
                  {source.lastError && (
                    <span
                      className="ml-4 text-xs text-gray-500 truncate max-w-md"
                      title={source.lastError}
                    >
                      {source.lastError}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white shadow rounded-lg overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={sources.length > 0 && selectedIds.size === sources.length}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称/URL</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型/标签</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">配置</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">上次运行</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">统计</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Errors</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">LastError</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sources.map(source => {
                const stats = source.stats;
                const antiBot = getAntiBotCooldown(source.lastError);
                
                return (
                  <tr key={source.id} id={`source-row-${source.id}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(source.id)}
                        onChange={() => handleSelectOne(source.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{source.name}</div>
                      <div className="text-xs text-gray-500 truncate max-w-xs" title={source.url}>{source.url}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{source.type}</div>
                      <div className="flex gap-1 mt-1">
                        {source.regionTag && <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-xs">{source.regionTag}</span>}
                        {source.categoryTag && <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-xs">{source.categoryTag}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>优先级: {source.priority}</div>
                      <div className="text-xs">间隔: {source.fetchIntervalMinutes}分</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>{source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleString() : '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {stats ? (
                        <div className="space-y-0.5">
                          <div>F: {stats.fetched} / U: {stats.upserted}</div>
                          <div>P: {stats.pushed} / S: {(stats.dedupSkipped || 0) + (stats.skippedByLimit || 0)}</div>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                      {stats ? stats.errors || 0 : 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 max-w-xs">
                      {source.lastError ? (
                        <span className="truncate block" title={source.lastError}>
                          {source.lastError}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => toggleStatus(source)}
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            source.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {source.isActive ? '启用' : '停用'}
                        </button>
                        {antiBot && (
                          <span className="text-xs text-red-600">
                            反爬屏蔽中，约 {Math.ceil(antiBot.remainingMs / (60 * 60 * 1000))} 小时后自动重试
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleDelete(source.id)}
                        className="text-red-600 hover:text-red-900 ml-4"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">批量上传数据源</h2>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">支持 CSV / Excel / JSON，单个文件不超过 50MB</div>
            <div className="flex items-center gap-2 text-sm">
              <a
                href="/api/sources/template?format=xlsx"
                className="px-2 py-1 border rounded text-blue-600 hover:bg-blue-50"
              >
                下载 Excel 模板
              </a>
              <a
                href="/api/sources/template?format=csv"
                className="px-2 py-1 border rounded text-blue-600 hover:bg-blue-50"
              >
                下载 CSV 模板
              </a>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <input
            type="file"
            multiple
            accept=".csv,.json,.xlsx,.xls"
            onChange={handleFilesSelected}
            className="block w-full text-sm text-gray-700"
          />
          {uploadFiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  共 {uploadSummary.total} 个文件，成功 {uploadSummary.success}，失败 {uploadSummary.failed}
                </div>
                <button
                  onClick={startUploadAll}
                  disabled={isUploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-400"
                >
                  {isUploading ? '上传中...' : '开始上传'}
                </button>
              </div>
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {uploadFiles.map((f, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between border rounded px-3 py-2 text-sm"
                  >
                    <div className="flex-1 mr-2 truncate">{f.file.name}</div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          f.status === 'success'
                            ? 'text-green-600'
                            : f.status === 'error'
                            ? 'text-red-600'
                            : f.status === 'uploading'
                            ? 'text-blue-600'
                            : 'text-gray-500'
                        }
                      >
                        {f.status === 'idle' && '待上传'}
                        {f.status === 'uploading' && '上传中'}
                        {f.status === 'success' && '已完成'}
                        {f.status === 'error' && (f.error || '失败')}
                      </span>
                      {f.status === 'error' && f.error !== '文件超过 50MB 限制' && (
                        <button
                          onClick={() => uploadSingleFile(index)}
                          className="px-2 py-1 border rounded text-xs"
                        >
                          重试
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center">
          <div className="bg-white p-6 rounded shadow-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">添加新数据源</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium">名称</label>
                <input
                  required
                  className="w-full border p-2 rounded"
                  value={formData.name || ''}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium">类型</label>
                  <select
                    className="w-full border p-2 rounded"
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                  >
                    <option value="RSS">RSS</option>
                    <option value="HTML">HTML</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">优先级 (1-5)</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    className="w-full border p-2 rounded"
                    value={formData.priority}
                    onChange={e =>
                      setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 3 })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium">URL</label>
                <input
                  required
                  className="w-full border p-2 rounded"
                  value={formData.url || ''}
                  onChange={e => setFormData({ ...formData, url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium">地区标签</label>
                  <input
                    className="w-full border p-2 rounded"
                    value={formData.regionTag || ''}
                    onChange={e => setFormData({ ...formData, regionTag: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">分类标签</label>
                  <input
                    className="w-full border p-2 rounded"
                    value={formData.categoryTag || ''}
                    onChange={e => setFormData({ ...formData, categoryTag: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border rounded text-gray-600"
                >
                  取消
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
