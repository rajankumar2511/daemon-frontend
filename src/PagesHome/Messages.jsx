/* ===================== Messages.jsx ===================== */

import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Paperclip, Trash2, X, CheckCircle, Smile, Image, Mic, File, MoreHorizontal, Download, Eye, CheckCheck } from "lucide-react";
import { toast } from "react-toastify";
import ChatHeader from "./ChatHeader";
import { emitTyping, emitStopTyping, socket } from "../Sockets/Socket";
import apiClient from "../lib/apiClient";
import { getCachedFile, setCachedFile } from "../utils/fileCache";

const Messages = ({
  me,
  selectedChat,
  messages,
  newMessage,
  setNewMessage,
  setMessages,
  sendMessage,
  deleteMessages,
  getOtherUser,
  formatTime,
  typing,
  onOpenFriends,
  handleFileSend,
  isMobile = false,
  onBack = null,
}) => {
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const lastSentFileRef = useRef(null);
  const ramCacheRef = useRef({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [fileDownloadStatus, setFileDownloadStatus] = useState({});

  const otherUser = selectedChat ? getOtherUser(selectedChat) : null;

  /* ================= CHECK IF FILE IS CACHED ================= */
  const checkFileCached = async (messageId) => {
    if (!messageId) return false;

    // Check RAM cache first
    if (ramCacheRef.current[messageId]) return true;

    // Check IndexedDB
    try {
      const cached = await getCachedFile(messageId);
      return !!cached;
    } catch {
      return false;
    }
  };

  /* ================= FILE VIEW HANDLER ================= */
  const handleFileView = async (e, messageId, fileData, msgObj = null) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const cacheKey = messageId || msgObj?._id;

      // Check RAM cache
      if (ramCacheRef.current[cacheKey]) {
        const blobUrl = URL.createObjectURL(ramCacheRef.current[cacheKey]);
        window.open(blobUrl, '_blank');
        toast.success(`Opening: ${fileData.name}`);
        return;
      }

      // Check IndexedDB
      const cachedBlob = await getCachedFile(cacheKey);
      if (cachedBlob) {
        ramCacheRef.current[cacheKey] = cachedBlob;
        const blobUrl = URL.createObjectURL(cachedBlob);
        window.open(blobUrl, '_blank');
        toast.success(`Opening: ${fileData.name}`);
        return;
      }

      // Fetch from server
      const viewToast = toast.info(`Loading ${fileData.name}...`, { autoClose: false });

      let downloadUrl = fileData.downloadUrl || `/chats/${selectedChat._id}/download/${fileData.publicId}`;
      if (downloadUrl.includes('/chat/') && !downloadUrl.includes('/chats/')) {
        downloadUrl = downloadUrl.replace('/chat/', '/chats/');
      }
      if (downloadUrl.startsWith('http')) {
        const urlObj = new URL(downloadUrl);
        downloadUrl = urlObj.pathname.replace('/api', '');
      }

      const response = await apiClient.get(downloadUrl, {
        responseType: 'blob',
        withCredentials: true
      });

      const blob = response.data;

      // Cache the file
      await setCachedFile(cacheKey, blob);
      ramCacheRef.current[cacheKey] = blob;

      // Update download status
      setFileDownloadStatus(prev => ({ ...prev, [cacheKey]: true }));

      toast.dismiss(viewToast);

      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      toast.success(`Opening: ${fileData.name}`);

    } catch (error) {
      console.error("View error:", error);
      toast.error("Failed to open file. Please try again.");
    }
  };

  /* ================= FILE DOWNLOAD HANDLER ================= */
  const handleFileDownload = async (e, fileData, messageId) => {
    e.preventDefault();
    e.stopPropagation();

    if (!fileData) return;

    const downloadToast = toast.info(`Downloading ${fileData.name}...`, { autoClose: false });

    try {
      let downloadUrl = fileData.downloadUrl || `/chats/${selectedChat._id}/download/${fileData.publicId}`;

      if (downloadUrl.includes('/chat/') && !downloadUrl.includes('/chats/')) {
        downloadUrl = downloadUrl.replace('/chat/', '/chats/');
      }

      if (downloadUrl.startsWith('http')) {
        const urlObj = new URL(downloadUrl);
        downloadUrl = urlObj.pathname.replace('/api', '');
      }

      const response = await apiClient.get(downloadUrl, {
        responseType: "blob",
        withCredentials: true
      });

      const blob = response.data;

      // Cache the file after download
      if (messageId) {
        await setCachedFile(messageId, blob);
        ramCacheRef.current[messageId] = blob;
        setFileDownloadStatus(prev => ({ ...prev, [messageId]: true }));
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileData.name || "file");
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.dismiss(downloadToast);
      toast.success(`Downloaded: ${fileData.name}`);
    } catch (error) {
      console.error("Download error:", error);
      toast.dismiss(downloadToast);
      toast.error("Failed to download file. Please try again.");
    }
  };

  /* ================= AUTO SCROLL ================= */
  useEffect(() => {
    if (!isSelectMode) {
      endRef.current?.scrollIntoView({
        behavior: messages.length < 20 ? "smooth" : "auto"
      });
    }
  }, [messages, typing, isSelectMode]);

  /* ================= CHECK CACHE STATUS FOR FILES ================= */
  useEffect(() => {
    const checkFilesCache = async () => {
      const fileMessages = messages.filter(m => m.type === "file" && m._id);
      for (const msg of fileMessages) {
        const isCached = await checkFileCached(msg._id);
        if (isCached !== fileDownloadStatus[msg._id]) {
          setFileDownloadStatus(prev => ({ ...prev, [msg._id]: isCached }));
        }
      }
    };

    if (messages.length > 0) {
      checkFilesCache();
    }
  }, [messages]);

  /* ================= SOCKET HANDLER ================= */
  useEffect(() => {
    const handler = ({ tempId, message }) => {
      setMessages(prev =>
        prev.map(msg =>
          msg.tempId === tempId
            ? { ...message, status: message.status || "sent" }
            : msg
        )
      );

      const senderId = message.sender?._id || message.sender;
      const myId = me?._id || me;
      const isMyMessage = senderId?.toString() === myId?.toString();

      if (message.type === "file" && isMyMessage) {
        let fileBlob = lastSentFileRef.current;

        if (!fileBlob && tempId) {
          fileBlob = ramCacheRef.current[tempId];
        }

        if (fileBlob) {
          ramCacheRef.current[message._id] = fileBlob;
          if (tempId) {
            ramCacheRef.current[tempId] = fileBlob;
          }

          setCachedFile(message._id, fileBlob)
            .then(() => setFileDownloadStatus(prev => ({ ...prev, [message._id]: true })))
            .catch(err => console.error("Failed to cache file:", err));

          lastSentFileRef.current = null;
        }
      }
    };

    socket.on("message-sent", handler);
    return () => socket.off("message-sent", handler);
  }, [me, setMessages]);

  /* ================= SELECTION LOGIC ================= */
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(i => i !== id);
        if (next.length === 0) setIsSelectMode(false);
        return next;
      }
      return [...prev, id];
    });
  };

  const enterSelectMode = (id) => {
    setIsSelectMode(true);
    setSelectedIds([id]);
    if (window.navigator.vibrate) window.navigator.vibrate(50);
  };

  const handleSelectAll = useCallback(() => {
    if (!messages.length) return;
    const myId = me?._id || me;
    const allIds = messages
      .filter(m => {
        const senderId = m.sender?._id || m.sender;
        return senderId?.toString() === myId?.toString() && !m.isDeleted;
      })
      .map(m => m._id);
    setSelectedIds(allIds);
    setIsSelectMode(true);
  }, [messages, me]);

  const cancelSelection = () => {
    setIsSelectMode(false);
    setSelectedIds([]);
  };

  /* ================= KEYBOARD SHORTCUTS ================= */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        if (selectedChat) {
          e.preventDefault();
          handleSelectAll();
        }
      }
      if (e.key === 'Escape' && isSelectMode) {
        cancelSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode, selectedChat, handleSelectAll]);

  /* ================= DELETE ACTION ================= */
  const handleDelete = async () => {
    if (!selectedIds.length) return;

    const idsToDelete = [...selectedIds];
    cancelSelection();
    setIsDeleting(true);

    let isCancelled = false;

    const undoToast = toast.info(
      <div className="flex items-center justify-between">
        <span>Deleting {idsToDelete.length} messages...</span>
        <button
          onClick={() => { isCancelled = true; toast.dismiss(undoToast); }}
          className="ml-4 px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-bold transition"
        >
          UNDO
        </button>
      </div>,
      {
        autoClose: 5000,
        pauseOnHover: true,
        closeOnClick: false,
        draggable: false,
        onClose: async () => {
          if (!isCancelled) {
            try {
              await deleteMessages(idsToDelete);
              toast.success("Messages deleted", { autoClose: 2000 });
            } catch (err) {
              console.error("Deletion failed:", err);
              toast.error("Failed to delete messages. Please try again.");
            }
          } else {
            toast.info("Deletion cancelled", { autoClose: 2000 });
          }
          setIsDeleting(false);
        }
      }
    );
  };

  /* ================= TYPING ================= */
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);

  const handleTypingInput = (e) => {
    const value = e.target.value;
    setNewMessage(value);

    if (!otherUser?._id || !selectedChat?._id) return;

    try {
      if (value.trim() && !isTypingRef.current) {
        emitTyping({ to: otherUser._id, chatId: selectedChat._id });
        isTypingRef.current = true;
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      typingTimeoutRef.current = setTimeout(() => {
        if (isTypingRef.current) {
          emitStopTyping({ to: otherUser?._id, chatId: selectedChat._id });
          isTypingRef.current = false;
        }
      }, 1000);

      if (!value.trim() && isTypingRef.current) {
        emitStopTyping({ to: otherUser._id, chatId: selectedChat._id });
        isTypingRef.current = false;
      }
    } catch (err) {
      console.error("[Messages] Typing error:", err);
    }
  };

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (isTypingRef.current && otherUser?._id && selectedChat?._id) {
        emitStopTyping({ to: otherUser._id, chatId: selectedChat._id });
        isTypingRef.current = false;
      }
    };
  }, [selectedChat?._id, otherUser?._id]);

  /* ================= SEND ================= */
  const handleSend = async () => {
    if (!newMessage.trim()) return;
    if (!selectedChat?._id) return;

    try {
      emitStopTyping({ to: otherUser?._id, chatId: selectedChat._id });
      await sendMessage();
    } catch (err) {
      console.error("[Messages] Send error:", err);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxFileSize = 50 * 1024 * 1024;
    if (file.size > maxFileSize) {
      toast.error("File too large! Maximum size: 50MB", { autoClose: 3000 });
      e.target.value = '';
      return;
    }

    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "video/mp4", "video/quicktime",
      "audio/mpeg", "audio/wav",
      "application/zip",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error(`File type not supported: ${file.type}`, { autoClose: 3000 });
      e.target.value = '';
      return;
    }

    try {
      setIsFileUploading(true);

      const tempId = `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      ramCacheRef.current[tempId] = file;

      const uploadToast = toast.info(`Uploading ${file.name}...`, { autoClose: false });

      await handleFileSend(file, tempId);
      lastSentFileRef.current = file;

      toast.dismiss(uploadToast);
      toast.success(`File sent: ${file.name}`, { autoClose: 2000 });
      e.target.value = '';
    } catch (err) {
      console.error("[Messages] File send error:", err);
      toast.error(err.response?.data?.message || err.message || "Failed to send file", { autoClose: 3000 });
    } finally {
      setIsFileUploading(false);
    }
  };

  const getMessageStatusUI = (status) => {
    if (status === "sent") {
      return <Check size={10} className="text-gray-400" />;
    }
    if (status === "sending") {
      return <div className="w-3 h-3 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin"></div>;
    }
    if (status === "delivered") {
      return (
        <Check
          size={14}
          className="text-gray-300 stroke-[2]"
        />
      );
    }

    if (status === "seen") {
      return (
        <CheckCheck
          size={14}
          className="text-blue-400 stroke-[2]"
        />
      );
    }
    return null;
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ================= FORMAT FILE SIZE ================= */
  const formatFileSize = (bytes) => {
    if (!bytes) return "Unknown size";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  };

  /* ================= EMPTY STATE ================= */
  if (!selectedChat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[radial-gradient(circle_at_10%_20%,#0B0B0F,#030305)]">
        <div className="text-center max-w-md mx-auto p-6 sm:p-8">
          <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6 rounded-full bg-gradient-to-r from-[#1e293b]/20 to-[#0f172a]/20 flex items-center justify-center">
            <svg className="w-10 h-10 sm:w-12 sm:h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">No conversation selected</h3>
          <p className="text-gray-400 text-sm sm:text-base mb-6">Choose a chat from the list to start messaging</p>
          <button
            onClick={onOpenFriends}
            className="px-5 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-[#1e293b] to-[#0f172a] text-white rounded-xl hover:from-[#334155] hover:to-[#1e293b] transition-all duration-200 transform hover:scale-105 shadow-lg text-sm sm:text-base border border-white/10"
          >
            Start New Chat
          </button>
        </div>
      </div>
    );
  }

  /* ================= RENDER ================= */
  return (
    <div className="flex-1 flex flex-col bg-[radial-gradient(circle_at_10%_20%,#0B0B0F,#030305)] relative overflow-hidden">

      {/* Grid Background Pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
  className="absolute inset-0"
  style={{
    backgroundImage: `
      linear-gradient(to right, rgba(99, 102, 241, 0.12) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(99, 102, 241, 0.12) 1px, transparent 1px)
    `,
    backgroundSize: '38px 38px',
    boxShadow: 'inset 0 0 40px rgba(99,102,241,0.15)'
  }}
></div>

        {/* Larger grid dots */}
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, rgba(100, 100, 150, 0.05) 1px, transparent 1px)`,
          backgroundSize: '30px 30px'
        }}></div>

        {/* Softer gradient orbs */}
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#1e293b]/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#0f172a]/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <ChatHeader
        otherUser={otherUser}
        isMobile={isMobile}
        onBack={onBack}
      />

      {/* SELECT MODE OVERLAY HEADER */}
      {isSelectMode && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-[#0B0B0F]/95 backdrop-blur-xl border-b border-white/10 p-3 sm:p-4 flex items-center justify-between animate-slide-down shadow-2xl">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={cancelSelection}
              className="p-2 rounded-xl hover:bg-white/10 transition-all duration-200 hover:scale-110"
            >
              <X size={18} className="sm:w-5 sm:h-5 text-gray-400" />
            </button>
            <span className="font-semibold text-white text-sm sm:text-base">{selectedIds.length} selected</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleSelectAll}
              className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all duration-200 hover:scale-105 border border-blue-400/20"
            >
              Select All
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 sm:py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all duration-300 transform hover:scale-105 text-sm font-medium border border-red-500/30"
            >
              <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* MESSAGES AREA */}
      <div className={`flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 transition-all duration-300 ${isDeleting ? 'opacity-50' : 'opacity-100'} custom-scrollbar relative z-10`}>
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-[#1e293b]/10 to-[#0f172a]/10 flex items-center justify-center">
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-gray-400 text-sm sm:text-base">No messages yet</p>
              <p className="text-xs text-gray-600 mt-1">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            if (!msg) return null;

            const senderId = msg.sender?._id || msg.sender;
            const myId = me?._id || me;
            const isMe = senderId?.toString() === myId?.toString();
            const isSelected = selectedIds.includes(msg._id);
            const isFileCached = fileDownloadStatus[msg._id];

            const showDate = idx === 0 || (new Date(msg.createdAt).toDateString() !== new Date(messages[idx - 1]?.createdAt).toDateString());

            return (
              <div
                key={msg._id ? msg._id.toString() : `temp-${msg.tempId}`}
                className={`group relative transition-all duration-300 ${isSelected ? 'scale-[0.98]' : 'scale-100'} animate-message-in`}
              >
                {showDate && (
                  <div className="text-center my-4 sm:my-6">
                    <span className="text-[10px] sm:text-xs text-gray-400 bg-[#1e293b]/30 backdrop-blur-md px-2 py-1 sm:px-3 sm:py-1.5 rounded-full border border-white/10">
                      {new Date(msg.createdAt).toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                )}

                <div className={`flex items-end gap-1.5 sm:gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                  {/* MULTI-SELECT CHECKBOX */}
                  {(isSelectMode && isMe) && (
                    <div
                      onClick={() => toggleSelect(msg._id)}
                      className={`flex-shrink-0 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all duration-200 mb-2 ${isSelected
                        ? 'bg-blue-500 border-blue-500 shadow-md shadow-blue-500/30'
                        : 'border-gray-500 hover:border-blue-400 hover:scale-110'
                        }`}
                    >
                      {isSelected && <CheckCircle size={10} className="sm:w-3 sm:h-3 text-white" />}
                    </div>
                  )}

                  {/* MESSAGE BUBBLE - Soothing Dark Colors for Sender */}
                  <div
                    onContextMenu={(e) => {
                      if (isMe) {
                        e.preventDefault();
                        enterSelectMode(msg._id);
                      }
                    }}
                    onClick={() => {
                      if (isSelectMode && isMe) toggleSelect(msg._id);
                    }}
                    className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl max-w-[85%] sm:max-w-[70%] relative cursor-default transition-all duration-300 shadow-lg ${isMe
                      ? `bg-[#5317b2] text-white rounded-br-sm ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0B0B0F] shadow-2xl' : ''
                      }`
                      : "bg-[#0B0B0F] backdrop-blur-md text-white rounded-bl-sm border border-white/10 shadow-lg hover:bg-[#111118] transition-colors"} 
                        ${isDeleting && isSelected ? 'animate-fade-out' : ''}`}
                  >
                    {msg.type === "file" ? (
                      <div className="flex flex-col gap-2 min-w-[200px] sm:min-w-[260px] max-w-full">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                            <File size={16} className="sm:w-5 sm:h-5 text-gray-300" />
                          </div>

                          {/* File Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs sm:text-sm font-medium leading-tight truncate text-gray-200" title={msg.file?.name}>
                              {msg.file?.name || "File"}
                            </p>
                            <p className="text-[10px] sm:text-xs text-gray-400">
                              {formatFileSize(msg.file?.size)}
                            </p>
                          </div>
                        </div>

                        {/* Action Buttons with Professional Borders */}
                        <div className="flex gap-2 pt-1">

                          {/* VIEW (INDIGO → BLUE) */}
                          {isFileCached ? (
                            <button
                              onClick={(e) => handleFileView(e, msg._id, msg.file, msg)}
                              className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg
      bg-gradient-to-r from-[#4338ca] to-[#2563eb]
      text-white border border-white/20
      hover:from-[#3730a3] hover:to-[#1d4ed8]
      transition-all duration-200
      flex items-center justify-center gap-1
      shadow-md hover:shadow-lg hover:scale-[1.03]"
                            >
                              <Eye size={13} className="sm:w-3.5 sm:h-3.5" />
                              <span>View</span>
                            </button>
                          ) : (

                            /* DOWNLOAD (BLUE → INDIGO) */
                            <button
                              onClick={(e) => handleFileDownload(e, msg.file, msg._id)}
                              className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg
      bg-gradient-to-r from-[#2563eb] to-[#4338ca]
      text-white border border-white/20
      hover:from-[#1d4ed8] hover:to-[#3730a3]
      transition-all duration-200
      flex items-center justify-center gap-1
      shadow-md hover:shadow-lg hover:scale-[1.03]"
                            >
                              <Download size={13} className="sm:w-3.5 sm:h-3.5" />
                              <span>Download</span>
                            </button>
                          )}

                          {/* PREVIEW (VIOLET → MAGENTA) */}
                          <button
                            onClick={(e) => handleFileView(e, msg._id, msg.file, msg)}
                            className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg
    bg-gradient-to-r from-[#7c3aed] to-[#be185d]
    text-white border border-white/20
    hover:from-[#6d28d9] hover:to-[#9d174d]
    transition-all duration-200
    flex items-center justify-center gap-1
    shadow-md hover:shadow-lg hover:scale-[1.03]"
                          >
                            <Eye size={13} className="sm:w-3.5 sm:h-3.5" />
                            <span>Preview</span>
                          </button>

                        </div>
                      </div>
                    ) : (
                      <p className="text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed text-gray-100">
                        {msg.content}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-1 mt-1.5 text-[8px] sm:text-[10px] opacity-60">
                      <span className="text-gray-00">{msg.createdAt ? formatTime(msg.createdAt) : ""}</span>
                      {isMe && msg.status && (
                        <span className="flex items-center gap-0.5 ml-1">
                          {getMessageStatusUI(msg.status)}
                        </span>
                      )}
                    </div>

                    {/* Bubble Tail - Matching dark colors */}
                    <div className={`absolute ${isMe ? '-right-1.5' : '-left-1.5'} bottom-2 w-3 h-3 ${isMe ? 'bg-[#1e293b]' : 'bg-[#0f172a]/80 backdrop-blur-md'} transform rotate-45 rounded-sm shadow-md`}></div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* TYPING INDICATOR */}
        {typing && typing.userId !== me?._id && otherUser && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-[#0f172a]/80 backdrop-blur-xl px-4 py-2.5 sm:px-5 sm:py-3 rounded-2xl rounded-bl-sm border border-white/10 shadow-xl">
              <div className="flex gap-1 mb-1">
                <span className="w-2 h-2 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
              <span className="text-[10px] sm:text-xs text-gray-300">
                {otherUser?.fullName?.split(' ')[0] || "User"} is typing...
              </span>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* INPUT AREA */}
      <div className={`p-3 sm:p-4 border-t border-white/10 bg-[#0B0B0F]/80 backdrop-blur-xl transition-all duration-300 ${isSelectMode ? 'translate-y-full' : 'translate-y-0'} relative z-10`}>
        <div className="flex gap-2 items-end">
          {/* FILE BUTTON */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isFileUploading}
            className={`p-2 sm:p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 border ${isFileUploading
              ? "bg-[#1e293b]/50 text-gray-600 cursor-not-allowed border-white/10"
              : "bg-[#1e293b] hover:bg-[#334155] text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 hover:shadow-lg hover:scale-105"
              }`}
            title={isFileUploading ? "Uploading file..." : "Attach file"}
          >
            {isFileUploading ? (
              <div className="w-4 h-4 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin" />
            ) : (
              <Paperclip size={16} className="sm:w-[18px] sm:h-[18px]" />
            )}
          </button>

          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={handleFileChange}
            disabled={isFileUploading}
          />

          {/* TEXT INPUT */}
          <div className="flex-1 relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"></div>
            <textarea
              value={newMessage}
              onChange={handleTypingInput}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="w-full bg-[#1e293b] backdrop-blur-md px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl outline-none resize-none text-white placeholder-gray-400 max-h-28 sm:max-h-32 border border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200 text-sm sm:text-base"
              rows={Math.min(2, Math.ceil(newMessage.length / 50) || 1)}
            />
          </div>

          {/* SEND BUTTON */}
          <button
            onClick={handleSend}
            disabled={!newMessage.trim()}
            className={`p-2 sm:p-2.5 rounded-xl transition-all duration-200 transform flex-shrink-0 border ${newMessage.trim()
              ? "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:scale-110 border-blue-600"
              : "bg-[#1e293b] text-gray-500 cursor-not-allowed border-gray-700"
              }`}
            title="Send message"
          >
            <Send size={16} className="sm:w-[18px] sm:h-[18px]" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fade-out {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.9); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes message-in {
          from { 
            opacity: 0; 
            transform: translateY(20px) scale(0.95); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0) scale(1); 
          }
        }
        
        .animate-slide-down { animation: slide-down 0.3s ease-out forwards; }
        .animate-fade-out { animation: fade-out 0.3s ease-in forwards; }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-message-in { animation: message-in 0.3s ease-out; }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #3b82f6, #8b5cf6);
          border-radius: 10px;
        }
        
        @media (min-width: 768px) {
          .custom-scrollbar::-webkit-scrollbar {
            width: 5px;
          }
        }
      `}</style>
    </div >
  );
};

export default Messages;
