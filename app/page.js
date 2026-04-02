"use client";

import { useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [formats, setFormats] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);

  const fetchFormats = async () => {
    if (!url.trim()) {
      setError("الرجاء إدخال رابط");
      return;
    }
    setLoading(true);
    setError("");
    setFormats([]);
    setSelectedFormat("");
    setInfo(null);

    try {
      const res = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل في جلب معلومات الفيديو");
      setFormats(data.formats);
      setInfo({ title: data.title, thumbnail: data.thumbnail, duration: data.duration });
      if (data.formats.length > 0) setSelectedFormat(data.formats[0].formatId);
      if (!data.formats || data.formats.length === 0) {
        throw new Error("لا توجد صيغ قابلة للتحميل لهذا الفيديو");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!selectedFormat) {
      setError("الرجاء اختيار الجودة");
      return;
    }
    setDownloadLoading(true);
    window.location.href = `/api/download?url=${encodeURIComponent(url)}&formatId=${selectedFormat}`;
  };

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap');
        body {
          font-family: 'Cairo', sans-serif;
        }
      `}</style>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-4" dir="rtl">
        {/* Arabic header - outside the card, centered */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">🫵🏻 🤣 هكروك يا طصطوص ؟</div>
          <div className="text-lg text-gray-600 dark:text-gray-300">موقع مخصص لطصطوص لانو عم يهكروه</div>
        </div>

        {/* Main card */}
        <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-center mb-6 text-gray-800 dark:text-white">
            تحميل الفيديوهات
          </h1>

          {/* URL Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              رابط الفيديو
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-left"
              dir="ltr"
            />
          </div>

          {/* Fetch Button with Spinner */}
          <button
            onClick={fetchFormats}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                جاري التحميل...
              </>
            ) : (
              "احصل على الصيغ المتاحة"
            )}
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* Video Info */}
          {info && (
            <div className="mt-4 flex items-center space-x-3 space-x-reverse p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
              {info.thumbnail && (
                <img src={info.thumbnail} alt="thumbnail" className="w-20 h-auto rounded" />
              )}
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-white">{info.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">المدة: {info.duration} ثانية</p>
              </div>
            </div>
          )}

          {/* Quality Selection */}
          {formats.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                اختر الجودة
              </label>
              <select
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                {formats.map((fmt) => (
                  <option key={fmt.formatId} value={fmt.formatId}>
                    {fmt.quality} ({fmt.ext}) {fmt.hasAudio ? "+ صوت" : " (فيديو فقط)"}
                  </option>
                ))}
              </select>
              <button
                onClick={download}
                disabled={downloadLoading}
                className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {downloadLoading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    جاري التحميل...
                  </>
                ) : (
                  "تحميل المحدد"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}