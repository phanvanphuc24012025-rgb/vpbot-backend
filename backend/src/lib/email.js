// ============================================
// email.js - Gửi email OTP qua Resend (HTTP API, tương thích Workers)
// Nếu không set RESEND_API_KEY, sẽ không gửi email thật -
// dựa vào DEV_MODE để trả OTP thẳng trong response lúc test.
// ============================================

export async function sendOtpEmail(env, { to, otp, type }) {
  if (!env.RESEND_API_KEY) {
    // Chưa cấu hình dịch vụ email thật - bỏ qua (xem DEV_MODE ở routes/auth.js)
    return { sent: false, reason: 'RESEND_API_KEY chưa được set' };
  }

  const subject = type === 'register' ? 'Xác thực đăng ký VPBot' : 'Đặt lại mật khẩu VPBot';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'VPBot <no-reply@vpbot.example.com>',
      to: [to],
      subject,
      html: `<p>Mã OTP của bạn là: <b style="font-size:20px">${otp}</b></p><p>Mã có hiệu lực trong thời gian ngắn, không chia sẻ cho ai khác.</p>`
    })
  });

  if (!res.ok) {
    const text = await res.text();
    return { sent: false, reason: text };
  }
  return { sent: true };
}
