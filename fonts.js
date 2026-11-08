// يحمّل خط Cairo دون حجب أول عرض للصفحة (ملف خارجي باش يتوافق مع CSP).
var l = document.createElement('link');
l.rel = 'stylesheet';
l.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400..900&display=optional';
document.head.appendChild(l);
