// يحوّل الزائر الحقيقي للتطبيق (الزواحف تقرا المحتوى الثابت). ملف خارجي باش يتوافق مع CSP.
var a = document.getElementById('open'); if (a) location.replace(a.href);
