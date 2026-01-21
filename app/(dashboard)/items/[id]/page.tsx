'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

export default function ItemDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [digest, setDigest] = useState<any>(null);
  const [isPushing, setIsPushing] = useState(false);

  useEffect(() => {
    if (id) fetchItem();
  }, [id]);

  const fetchItem = async () => {
    const res = await fetch(`/api/items/${id}`);
    const data = await res.json();
    setItem(data);
    if (data.digest) {
      try {
        setDigest(JSON.parse(data.digest));
      } catch (e) {
        setDigest({});
      }
    }
    setLoading(false);
  };

  const handleStatusChange = async (status: string) => {
    await fetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    fetchItem();
    router.refresh();
  };

  const saveDigest = async () => {
    await fetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest })
    });
    alert('Digest saved!');
  };

  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);

  const handleAiAnalyze = async () => {
    setIsAiAnalyzing(true);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_analyze' })
      });
      const data = await res.json();
      if (data.success && data.digest) {
        setDigest(data.digest);
        alert('AI 分析完成！');
      } else {
        alert('AI 分析失败: ' + (data.error || '未知错误'));
      }
    } catch (error) {
      alert('请求出错: ' + error);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  const pushToWeCom = async () => {
    setIsPushing(true);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'wecom_push' })
      });
      const data = await res.json();
      if (data.success) {
        alert('已推送到企业微信！');
      } else {
        alert('推送失败: ' + (data.error || '未知错误'));
      }
    } catch (error) {
      alert('推送发生错误: ' + error);
    } finally {
      setIsPushing(false);
    }
  };

  if (loading || !item) return <div className="p-8">加载中...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/inbox" className="text-blue-600 hover:underline">← 返回收件箱</Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <span className="text-sm text-gray-500">{item.source.name}</span>
            <h1 className="text-2xl font-bold mt-1 mb-2">{item.title}</h1>
            <a href={item.url} target="_blank" className="text-blue-600 text-sm hover:underline">原文链接 ↗</a>
          </div>
          <div className="flex space-x-2">
            {item.status === 'PENDING' && (
              <>
                <button onClick={handleAiAnalyze} disabled={isAiAnalyzing} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mr-2">
                  {isAiAnalyzing ? 'AI 分析中...' : 'AI 智能分析'}
                </button>
                <button onClick={() => handleStatusChange('APPROVED')} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">通过</button>
                <button onClick={() => handleStatusChange('REJECTED')} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">拒绝</button>
              </>
            )}
            {item.status === 'APPROVED' && (
               <div className="flex space-x-2 items-center">
                 <span className="text-green-600 font-bold px-2">已通过</span>
                 <button onClick={pushToWeCom} disabled={isPushing} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
                   {isPushing ? '推送中...' : '推企业微信'}
                 </button>
               </div>
            )}
            {item.status === 'REJECTED' && <span className="text-red-600 font-bold px-2">已拒绝</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Raw Text & Events */}
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-6">
             <h2 className="text-lg font-bold mb-4">提取的事件</h2>
             {item.events.length === 0 ? <p className="text-gray-500">未发现事件。</p> : (
               <ul className="space-y-2">
                 {item.events.map((e: any) => (
                   <li key={e.id} className="border-b pb-2">
                     <div className="font-semibold">{new Date(e.date).toLocaleDateString()}</div>
                     <div className="text-sm text-gray-600">{e.type}</div>
                   </li>
                 ))}
               </ul>
             )}
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-bold mb-4">原始内容</h2>
            <div className="h-64 overflow-y-auto bg-gray-50 p-4 rounded text-sm whitespace-pre-wrap text-gray-700">
              {item.rawText}
            </div>
          </div>
        </div>

        {/* Right Column: Digest Editor */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">摘要编辑器</h2>
            <button onClick={saveDigest} className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">保存更改</button>
          </div>
          
          {digest && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">摘要 (Summary)</label>
                <textarea 
                  className="w-full border p-2 rounded h-24"
                  value={digest.summary || ''}
                  onChange={e => setDigest({...digest, summary: e.target.value})}
                  placeholder="文章摘要..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">核心要点 (Key Points)</label>
                <textarea 
                  className="w-full border p-2 rounded h-32"
                  value={digest.key_points?.join('\n') || ''}
                  onChange={e => setDigest({...digest, key_points: e.target.value.split('\n')})}
                  placeholder="每行一个要点"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">附件列表 (Attachments)</label>
                <div className="space-y-2">
                  {digest.attachments?.map((att: any, idx: number) => (
                    <div key={idx} className="flex gap-2">
                       <input 
                         className="border p-1 rounded flex-1" 
                         value={att.name} 
                         onChange={e => {
                            const newAtts = [...(digest.attachments || [])];
                            newAtts[idx].name = e.target.value;
                            setDigest({...digest, attachments: newAtts});
                         }}
                       />
                       <input 
                         className="border p-1 rounded flex-1" 
                         value={att.url} 
                         onChange={e => {
                            const newAtts = [...(digest.attachments || [])];
                            newAtts[idx].url = e.target.value;
                            setDigest({...digest, attachments: newAtts});
                         }}
                       />
                    </div>
                  ))}
                  <button 
                    onClick={() => setDigest({...digest, attachments: [...(digest.attachments || []), {name: '', url: ''}]})}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + 添加附件
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
