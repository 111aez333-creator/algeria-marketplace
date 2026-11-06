// إعداد Firebase — عوّض القيم التالية بقيم مشروعك من Firebase Console
// (Project settings → General → Your apps → SDK setup and configuration)
//
// هذا الملف يُحمَّل من app.js، admin.js، ومن sw.js، ويجب أن يبقى في نفس مجلد index.html.

export const firebaseConfig = {
  apiKey: "AIzaSyDl8NxZS0WmyjeJpnS6BVWgL3_xi4dye-E",
  authDomain: "gallery-3008c.firebaseapp.com",
  databaseURL: "https://gallery-3008c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gallery-3008c",
  storageBucket: "gallery-3008c.firebasestorage.app",
  messagingSenderId: "277706027135",
  appId: "1:277706027135:web:85cb7d9c2737af5547cf4a",
  measurementId: "G-22VJPFBSYB"
};

// App Check (Fraud Defense / reCAPTCHA Enterprise) — الـ Site key فقط. نفس القيمة تتحط فـ Firebase Console → App Check → Fraud Defense.
// مفتاح الموقع (site key) عام وما فيهش سر. تأكد أنو نفس المفتاح المسجّل عندك بالضبط.
export const appCheckSiteKey = "6Lfl6wkuAAAAAP4wRW1dpFw5yGzTZMy93KmqYmhW";
