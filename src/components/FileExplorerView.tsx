import React, { useState, useEffect } from "react";
import { Plus, HardDrive, File, Trash2, Upload, AlertCircle, FileText, CheckCircle2 } from "lucide-react";
import { AppFile } from "../types";

export default function FileExplorerView() {
  const [files, setFiles] = useState<AppFile[]>(() => {
    const saved = localStorage.getItem("life_os_files");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        name: "Welcome_to_LifeOS.txt",
        path: "/",
        size: 245,
        mimeType: "text/plain",
        uriString: "base64:V2VsY29tZSB0byBMaWZlIE9TISBUaGlzIGlzIHlvdXIgYWxsLWluLW9uZSBwcm9kdWN0aXZpdHkgZW5naW5lLiBPcmdhbml6ZSB0YXNrcywgdHJhY2sgZmluYW5jZXMsIHdyaXRlIGRhaWx5IGpvdXJuYWxzLCBhbmQgYm9vc3QgeW91ciBmb2N1cyB3aXRoIG91ciBwb3dlcmZ1bCBUaW1lciE=",
        timestamp: Date.now() - 3600 * 24 * 1000
      }
    ];
  });

  const [dragActive, setDragActive] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("life_os_files", JSON.stringify(files));
  }, [files]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64Content = result.split(",")[1] || "";
      
      const newFile: AppFile = {
        id: Date.now(),
        name: file.name,
        path: "/",
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        uriString: `base64:${base64Content}`,
        timestamp: Date.now()
      };

      setFiles(prev => [newFile, ...prev]);
      setSuccessMsg(`File "${file.name}" uploaded successfully.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const deleteFile = (id: number) => {
    setFiles(files.filter(f => f.id !== id));
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const downloadFile = (file: AppFile) => {
    if (!file.uriString.startsWith("base64:")) return;
    const rawBase64 = file.uriString.substring("base64:".length);
    const byteCharacters = atob(rawBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: file.mimeType });
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Upload Drag & Drop Box */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 select-none">
          <Upload className="h-4 w-4 text-blue-500" />
          File Ingestion
        </h2>
        
        {/* Upload Box */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`h-48 rounded-xl border border-dashed flex flex-col items-center justify-center text-center p-5 transition-all select-none relative
            ${dragActive 
              ? "border-blue-500 bg-blue-500/5" 
              : "border-gray-800 bg-gray-950 hover:border-gray-700"}`}
        >
          <input
            type="file"
            onChange={handleFileInput}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <FileText className="h-10 w-10 text-gray-500 mb-3 animate-pulse" />
          <p className="text-xs font-bold text-gray-300">Drag & drop files here</p>
          <p className="text-[10px] text-gray-500 mt-1">or click to browse local files</p>
        </div>

        {successMsg && (
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      {/* Directory database view */}
      <div className="lg:col-span-2 bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col h-[400px]">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 border-b border-gray-900 pb-3 select-none">
          <HardDrive className="h-4 w-4 text-blue-500" />
          Local Storage Vault ({files.length} Files)
        </h2>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {files.map((file) => (
            <div
              key={file.id}
              className="p-3.5 bg-gray-900/35 border border-gray-850 hover:border-gray-800 rounded-xl flex items-center justify-between gap-4 transition-all"
            >
              <button
                onClick={() => downloadFile(file)}
                className="flex items-center gap-3.5 min-w-0 text-left hover:text-blue-400 cursor-pointer flex-1"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 select-none">
                  <File className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-white block truncate">
                    {file.name}
                  </span>
                  <span className="text-[9px] font-mono text-gray-500 block mt-0.5 select-none">
                    {formatBytes(file.size)} • {file.mimeType}
                  </span>
                </div>
              </button>

              <div className="flex items-center gap-2 select-none">
                <button
                  onClick={() => deleteFile(file.id)}
                  className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900/30 transition-all cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {files.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center p-12 space-y-2 h-full">
              <AlertCircle className="h-8 w-8 text-gray-600 animate-bounce" />
              <p className="text-xs text-gray-500">No documents logged in this directory. Upload a secure file!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
