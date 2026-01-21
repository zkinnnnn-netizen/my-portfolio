import { NextResponse } from 'next/server';

export async function GET() {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.json({ 
      error: '配置缺失', 
      message: '请先检查 .env 文件，确保 WECHAT_APP_ID 和 WECHAT_APP_SECRET 已正确填写，并且没有语法错误（如缺少引号）。' 
    });
  }

  try {
    // 1. 获取 Access Token
    const tokenRes = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`);
    const tokenData = await tokenRes.json();
    
    if (!tokenData.access_token) {
      throw new Error(`获取 Token 失败: ${tokenData.errmsg} (请检查 AppID/Secret 是否正确，以及是否配置了 IP 白名单)`);
    }

    // 2. 准备一张 1x1 像素的透明 PNG 图片 (Hex 字符串转 Buffer)
    // 这是为了上传一个合法的“永久素材”图片，用作默认封面
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d740000000049454e44ae426082';
    // 注意：Node.js 环境下 Buffer 可以直接使用
    const buffer = Buffer.from(pngHex, 'hex');
    
    // 构造 FormData
    const formData = new FormData();
    // 必须指定文件名，否则微信 API 可能会报错
    const blob = new Blob([buffer], { type: 'image/png' });
    formData.append('media', blob, 'default_cover.png');

    // 3. 上传到微信“新增永久素材”接口
    // 注意：存草稿必须使用“永久素材”的 media_id，不能用临时素材
    const uploadRes = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${tokenData.access_token}&type=image`, {
      method: 'POST',
      body: formData,
    });

    const uploadData = await uploadRes.json();

    if (uploadData.media_id) {
       return NextResponse.json({
         success: true,
         message: "🎉 获取成功！请复制下面的 media_id 填入 .env 文件",
         media_id: uploadData.media_id,
         url: uploadData.url,
         instruction: `请打开 .env 文件，设置 WECHAT_DEFAULT_THUMB_ID="${uploadData.media_id}"`
       });
    } else {
       throw new Error(`上传图片失败: ${JSON.stringify(uploadData)}`);
    }

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
