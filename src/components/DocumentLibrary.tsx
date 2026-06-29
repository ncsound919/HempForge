import React, { useState, useRef, useMemo } from 'react';
import { 
  FolderOpen, 
  FileText, 
  Upload, 
  FolderUp, 
  Trash2, 
  Edit3, 
  Check, 
  Download, 
  FileCode, 
  Database, 
  Sparkles, 
  AlertCircle,
  FolderMinus,
  CheckCircle2,
  Info,
  Calendar,
  Save,
  HelpCircle
} from 'lucide-react';

export interface DocumentEntry {
  id: string;
  name: string;
  path: string; // Dynamic folder/nested directory simulated path
  size: string;
  type: 'pdf' | 'md' | 'txt' | 'csv';
  uploadDate: string;
  title: string;
  journal: string;
  year: number;
  authors: string;
  abstract: string;
  compounds: string[];
  dosage: string;
  outcomes: string;
  isCustom?: boolean;
}

export default function DocumentLibrary({ 
  onPaperSelected,
  papers,
  onPapersChange
}: { 
  onPaperSelected?: (paper: any) => void;
  papers?: DocumentEntry[];
  onPapersChange?: (papers: DocumentEntry[]) => void;
}) {
  const [localDocuments, setLocalDocuments] = useState<DocumentEntry[]>([]);
  const documents = papers || localDocuments;
  const setDocuments = onPapersChange || setLocalDocuments;
  const [selectedDocId, setSelectedDocId] = useState<string>('doc-1');
  
  // Folders view state
  const [currentFolderFilter, setCurrentFolderFilter] = useState<string>('All');
  
  // Edit variables
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [editedJournal, setEditedJournal] = useState<string>('');
  const [editedAuthors, setEditedAuthors] = useState<string>('');
  const [editedAbstract, setEditedAbstract] = useState<string>('');
  const [editedCompounds, setEditedCompounds] = useState<string>('');
  const [editedDosage, setEditedDosage] = useState<string>('');
  const [editedOutcomes, setEditedOutcomes] = useState<string>('');
  const [editedYear, setEditedYear] = useState<string>('2026');

  // File Upload Ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Computed directories list
  const foldersList = useMemo(() => {
    const folders = new Set<string>();
    documents.forEach(doc => {
      // Split into directory pieces or keep full path
      folders.add(doc.path);
    });
    return ['All', ...Array.from(folders)];
  }, [documents]);

  const selectedDoc = documents.find(d => d.id === selectedDocId) || documents[0];

  const handleSelectDoc = (doc: DocumentEntry) => {
    setSelectedDocId(doc.id);
    setIsEditing(false);
    
    // Set edit variables
    setEditedTitle(doc.title);
    setEditedJournal(doc.journal);
    setEditedAuthors(doc.authors);
    setEditedAbstract(doc.abstract);
    setEditedCompounds(doc.compounds.join(', '));
    setEditedDosage(doc.dosage);
    setEditedOutcomes(doc.outcomes);
    setEditedYear(String(doc.year));

    if (onPaperSelected) {
      onPaperSelected(doc);
    }
  };

  // Drag handers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const showStatusNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Simulate file analysis with machine learning metrics
  const triggerFileAnalysisSim = (fileName: string, type: 'pdf' | 'md' | 'txt' | 'csv', folderPath: string = '/Self_Uploads/Raw/') => {
    const defaultMeta: DocumentEntry = {
      id: `doc-uploaded-${Date.now()}`,
      name: fileName,
      path: folderPath,
      size: `${(Math.random() * 2 + 0.1).toFixed(1)} MB`,
      type: type,
      uploadDate: new Date().toISOString().split('T')[0],
      title: `${fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ")} Analysis`,
      journal: 'Inter-Agency Extraction Logs (Simulated)',
      year: 2026,
      authors: 'HempForge Automation Parsing Agent',
      abstract: `This file was imported under automated scientific NLP routines. Initial scanning targets acidic cannabinoids and compliance matrices. It presents raw content extraction layers with simulated UV peaks and local compliance warnings.`,
      compounds: ['THCa', 'CBDa'],
      dosage: 'Raw batch content mapping',
      outcomes: 'Extracted 12 active keywords with compliance correlation rating above 98%.'
    };

    setDocuments([defaultMeta, ...documents]);
    setSelectedDocId(defaultMeta.id);
    showStatusNotification(`Successfully parsed & extracted research metadata from "${fileName}"`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const isFolder = (file as any).type === "" && file.size % 4096 === 0; // standard file API check
      const ext = file.name.split('.').pop()?.toLowerCase();
      const typeMap: any = { pdf: 'pdf', md: 'md', txt: 'txt', csv: 'csv' };
      
      triggerFileAnalysisSim(file.name, typeMap[ext || ''] || 'pdf', isFolder ? '/Folder_Import/' : '/Self_Uploads/Raw/');
    }
  };

  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>, isFolder: boolean) => {
    if (e.target.files && e.target.files[0]) {
      const files = e.target.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop()?.toLowerCase();
        const typeMap: any = { pdf: 'pdf', md: 'md', txt: 'txt', csv: 'csv' };
        
        // Use relative webkitRelativePath for folders if present to simulate relative folder paths!
        const relativePath = file.webkitRelativePath 
          ? `/${relativePathToFolder(file.webkitRelativePath)}/` 
          : (isFolder ? '/Batch_Folder_Upload/' : '/Manual_Uploads/');
        
        triggerFileAnalysisSim(file.name, typeMap[ext || ''] || 'pdf', relativePath);
      }
    }
  };

  const relativePathToFolder = (fullPath: string) => {
    const parts = fullPath.split('/');
    if (parts.length > 1) {
      return parts.slice(0, -1).join('/');
    }
    return 'Imported_Folder';
  };

  // Update paper metadata on save
  const handleSaveChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc) return;

    const updated = documents.map(doc => {
      if (doc.id === selectedDoc.id) {
        return {
          ...doc,
          title: editedTitle,
          journal: editedJournal,
          authors: editedAuthors,
          year: parseInt(editedYear) || 2026,
          abstract: editedAbstract,
          compounds: editedCompounds.split(',').map(s => s.trim()).filter(Boolean),
          dosage: editedDosage,
          outcomes: editedOutcomes
        };
      }
      return doc;
    });

    setDocuments(updated);
    setIsEditing(false);
    showStatusNotification(`Document changes pushed successfully & updated local knowledge indexes.`);
  };

  // Delete Document
  const handleDeleteDoc = (id: string) => {
    if (documents.length <= 1) {
      showStatusNotification("Error: Cannot delete the last remaining research paper baseline.");
      return;
    }
    const filtered = documents.filter(d => d.id !== id);
    setDocuments(filtered);
    setSelectedDocId(filtered[0].id);
    showStatusNotification(`Removed article index.`);
  };

  // EXPORT SIMULATOR TO LOCAL STORAGE / DOWNLOADING AS STYLED ARTIFACTS
  const handleExportAsMarkdown = (doc: DocumentEntry) => {
    const content = `# HempForge Science Digest: ${doc.title}
-------------------------------------------------------
Source Database: HempForge Research Lab
Article ID: ${doc.id}
Journal Ref: ${doc.journal} (${doc.year})
Authors: ${doc.authors}
Export Date: ${new Date().toLocaleDateString()}

## Compounds Isolated
${doc.compounds.map(c => `- ${c}`).join('\n')}

## Targets & Dosage Metrics
- ${doc.dosage}

## Extraction Outcomes & Compliance Logs
- ${doc.outcomes}

## Main Abstract
${doc.abstract}

---
Exported automatically via HempForge Compliance & Research Engine.
Confidential / Laboratory Use Only.`;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${doc.name?.replace(/\.[^/.]+$/, "")}_digest.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatusNotification(`Successfully downloaded Markdown (.md) digest file.`);
  };

  const handleExportAsPDF = (doc: DocumentEntry) => {
    // Generate simulated print PDF styled brief
    const outline = `================================================================================
                    HEMPFORGE LABORATORY SUMMARY BRIEF
================================================================================
SECTION I: ARTIFACT REFERENCE METRIC
- Document Title:   ${doc.title}
- Source Citation:  ${doc.journal}, Vol. ${doc.year}
- Author Matrix:    ${doc.authors}
- Local Path:       ${doc.path}${doc.name}

SECTION II: COMPOUND IDENTIFIERS
- Isolated Cannabinoids / Target Active Species: ${doc.compounds.join(', ')}
- Laboratory Dosage Profile: ${doc.dosage}

SECTION III: CORE OUTCOMES & POTENCY RATIOS
- Critical Findings : ${doc.outcomes}

SECTION IV: COMPREHENSIVE RECONSTRUCTED ABSTRACT
- Abstract:
  ${doc.abstract}

================================================================================
Generated for: Scientific Auditor
System State: SECURE / VERIFIED
Compliance Code: CA-EPA-D9-0.3WT
Timestamp: ${new Date().toISOString()}
================================================================================`;

    const blob = new Blob([outline], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${doc.name?.replace(/\.[^/.]+$/, "")}_regulatory_brief.doc`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatusNotification(`Successfully generated structured Laboratory Brief (.doc format)`);
  };

  // Filter dynamic lists
  const filteredDocuments = documents.filter(doc => currentFolderFilter === 'All' || doc.path === currentFolderFilter);

  return (
    <div id="document-library-workstation" className="space-y-6">
      
      {/* Notifications */}
      {notification && (
        <div className="bg-emerald-500 text-[#0A0F0D] p-3 text-xs font-mono flex items-center gap-2 animate-in fade-in slide-in-from-top-4 relative z-50">
          <CheckCircle2 size={16} />
          {notification}
        </div>
      )}

      {/* Upload Station Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Upload Action Zone & Directory Tree Selector */}
        <div className="bg-[#0D1411] border border-white/10 p-5 space-y-5">
          <div>
            <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
              <Upload size={14} /> Import Folder / Science Papers
            </h4>
            <p className="text-[11px] text-white/50 mt-1">
              Drag & drop entire folders containing PDFs, TXT, or science articles directly. The RAG extractor simulates file mapping.
            </p>
          </div>

          {/* Interactive Drag & Drop Box */}
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed p-6 text-center transition-colors duration-150 cursor-pointer flex flex-col items-center justify-center min-h-[140px] ${
              dragActive 
                ? 'border-emerald-400 bg-emerald-500/5' 
                : 'border-white/15 bg-white/5 hover:border-white/30'
            }`}
          >
            <FolderUp size={32} className={`${dragActive ? 'text-emerald-400' : 'text-slate-500'} mb-2`} />
            <p className="text-xs text-white/70 font-sans">
              Drag or drop PDFs / research source folders
            </p>
            <span className="text-[10px] font-mono text-white/40 mt-1 block">Or click to browse</span>

            {/* Browsers controls */}
            <div className="flex justify-center gap-2 mt-4">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-[#1A221E] text-white/80 border border-white/10 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider hover:text-white hover:bg-emerald-500/10 transition-colors"
              >
                File Select
              </button>
              <button 
                onClick={() => folderInputRef.current?.click()}
                className="bg-[#1A221E] text-white/80 border border-white/10 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider hover:text-white hover:bg-purple-500/10 transition-colors"
                title="Upload entire file system directories recursively"
              >
                Folder Select
              </button>
            </div>

            <input 
              ref={fileInputRef} 
              type="file" 
              className="hidden" 
              multiple 
              onChange={(e) => handleManualUpload(e, false)} 
              accept=".pdf,.txt,.md,.csv" 
            />
            {/* Folder uploading directory attribute */}
            <input 
              ref={folderInputRef} 
              type="file" 
              className="hidden" 
              // @ts-expect-error — webkitdirectory is non-standard but supported by browsers
              webkitdirectory="" 
              multiple 
              onChange={(e) => handleManualUpload(e, true)} 
            />
          </div>

          {/* Virtual File Subdirectories Tree Filter list */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <span className="text-[9px] font-mono text-white/40 uppercase block">Virtual Root Directory Paths</span>
            <div className="space-y-1 h-44 overflow-y-auto pr-2">
              {foldersList.map((f, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentFolderFilter(f)}
                  className={`w-full text-left p-2 text-[10px] font-mono flex items-center justify-between transition-colors ${
                    currentFolderFilter === f
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-[#121915] text-slate-400 border border-transparent hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="truncate flex items-center gap-1.5">
                    <FolderOpen size={11} className={currentFolderFilter === f ? 'text-emerald-400' : 'text-slate-500'} />
                    {f}
                  </span>
                  <span className="text-[9px] bg-[#0A0F0D] px-1.5 py-0.5 text-white/50">
                    {f === 'All' ? documents.length : documents.filter(doc => doc.path === f).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic Documents List Panel */}
        <div className="bg-[#0D1411] border border-white/10 p-5 flex flex-col h-[460px] lg:col-span-1 justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-white/40 uppercase font-bold tracking-widest">Library Search results ({filteredDocuments.length})</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5">DB Connected</span>
            </div>

            <div className="space-y-2 h-[380px] overflow-y-auto pr-1">
              {filteredDocuments.map((doc) => (
                <div 
                  key={doc.id}
                  onClick={() => handleSelectDoc(doc)}
                  className={`border p-3 cursor-pointer relative group transition-all duration-150 ${
                    selectedDocId === doc.id
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-[#121915] border-white/5 hover:border-white/15 hover:bg-white/5'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="text-[8px] font-mono bg-[#0A0F0D] text-slate-400 px-1.5 py-0.5 uppercase tracking-wide border border-white/5">
                      {doc.type.toUpperCase()} • {doc.size}
                    </span>
                    
                    {/* Trash tool */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDoc(doc.id);
                      }}
                      className="text-white/20 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Deplane document article metadata"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <h5 className={`text-xs font-semibold leading-relaxed line-clamp-2 ${selectedDocId === doc.id ? 'text-emerald-400' : 'text-slate-200'}`}>
                    {doc.title}
                  </h5>

                  <p className="text-[10px] text-white/40 mt-1 truncate font-mono">
                    Path: {doc.path}
                  </p>

                  <div className="flex items-center gap-1.5 mt-2 text-[9px] text-emerald-500/60 font-mono">
                    <Calendar size={10} /> {doc.uploadDate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live Analysis Extraction & Save/Edit Control Board */}
        <div id="document-analyzer-card" className="bg-[#0D1411] border border-white/10 p-6 lg:col-span-1 flex flex-col justify-between h-[460px]">
          <div className="space-y-4 overflow-y-auto h-[350px] pr-2">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles size={14} className="text-amber-400" />
                  AI RAG Extraction Panel
                </h4>
                <p className="text-[10px] text-white/40 uppercase font-mono mt-0.5">
                  Accuracy rating: <span className="text-emerald-400 font-bold">99.4% Verified</span>
                </p>
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={`px-2 py-1 font-mono text-[9px] uppercase border transition-colors ${
                    isEditing 
                      ? 'bg-amber-500 text-black border-amber-400' 
                      : 'bg-white/5 text-slate-300 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {isEditing ? 'Cancel Edit' : 'Edit Specs'}
                </button>
              </div>
            </div>

            {/* Editing State Form */}
            {isEditing ? (
              <form onSubmit={handleSaveChanges} className="space-y-3 font-mono text-[10px]">
                <div className="space-y-1">
                  <label className="text-[8px] text-white/40 uppercase">Scientific Paper Title</label>
                  <input 
                    type="text" 
                    value={editedTitle} 
                    onChange={e => setEditedTitle(e.target.value)}
                    className="w-full bg-[#1A221E] p-2 text-emerald-400 border border-white/10 rounded-none focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[8px] text-white/40 uppercase">Journal Name</label>
                    <input 
                      type="text" 
                      value={editedJournal} 
                      onChange={e => setEditedJournal(e.target.value)}
                      className="w-full bg-[#1A221E] p-2 text-white/80 border border-white/10 rounded-none focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] text-white/40 uppercase">Publication Year</label>
                    <input 
                      type="number" 
                      value={editedYear} 
                      onChange={e => setEditedYear(e.target.value)}
                      className="w-full bg-[#1A221E] p-2 text-white/80 border border-white/10 rounded-none focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-white/40 uppercase">Active Compounds (comma-split)</label>
                  <input 
                    type="text" 
                    value={editedCompounds} 
                    onChange={e => setEditedCompounds(e.target.value)}
                    className="w-full bg-[#1A221E] p-2 text-emerald-400 border border-white/10 rounded-none focus:outline-none"
                    placeholder="e.g. THCa, CBC"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-white/40 uppercase">Dosage Profile Target</label>
                  <input 
                    type="text" 
                    value={editedDosage} 
                    onChange={e => setEditedDosage(e.target.value)}
                    className="w-full bg-[#1A221E] p-2 text-white border border-white/10 rounded-none focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-white/40 uppercase">Critical Research Highlights</label>
                  <input 
                    type="text" 
                    value={editedOutcomes} 
                    onChange={e => setEditedOutcomes(e.target.value)}
                    className="w-full bg-[#1A221E] p-2 text-white border border-white/10 rounded-none focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] text-white/40 uppercase">Scientific Abstract</label>
                  <textarea 
                    rows={3}
                    value={editedAbstract} 
                    onChange={e => setEditedAbstract(e.target.value)}
                    className="w-full bg-[#1A221E] p-2 text-white/80 border border-white/10 rounded-none focus:outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 text-[#0A0F0D] py-2 font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-400 transition-colors"
                >
                  <Save size={13} /> Save Edited Document
                </button>
              </form>
            ) : (
              /* Display Extracted Metadata Info */
              <div className="space-y-4">
                <div className="p-3 bg-white/5 border-l-2 border-emerald-500 space-y-1">
                  <span className="text-[8px] font-mono text-white/40 uppercase block">Verified Source Publication</span>
                  <p className="text-xs font-semibold text-white tracking-tight">{selectedDoc?.title}</p>
                  <span className="text-[10px] text-emerald-400 font-mono block">
                    {selectedDoc?.journal} ({selectedDoc?.year})
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-mono text-white/40 uppercase block">Compounds Extracted</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedDoc?.compounds.map((comp, idx) => (
                      <span key={idx} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-none font-mono text-[9px]">
                        {comp}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-mono text-white/40 uppercase block">Dosage Matrix Specs</span>
                  <p className="text-[11px] text-white/80 font-mono italic">{selectedDoc?.dosage}</p>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-mono text-white/40 uppercase block">Key Finding Outcomes</span>
                  <p className="text-[11px] text-[#A7F3D0] leading-relaxed font-semibold">{selectedDoc?.outcomes}</p>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-mono text-white/40 uppercase block">Scientific Abstract</span>
                  <p className="text-[10px] text-white/60 leading-relaxed font-sans">{selectedDoc?.abstract}</p>
                </div>
              </div>
            )}
          </div>

          {/* Download & Export Brief Actions Bar */}
          <div className="border-t border-white/10 pt-4 mt-2 space-y-2">
            <span className="text-[8px] font-mono text-white/40 uppercase block">Export and Publication Dispatcher</span>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => handleExportAsMarkdown(selectedDoc)}
                className="bg-[#121915] border border-white/10 hover:border-emerald-500/40 text-slate-200 hover:text-white px-3 py-2 text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                title="Download study brief file as complete markdown format"
              >
                <Download size={12} className="text-slate-500" /> Markdown
              </button>
              <button 
                onClick={() => handleExportAsPDF(selectedDoc)}
                className="bg-[#121915] border border-white/10 hover:border-emerald-500/40 text-slate-200 hover:text-white px-3 py-2 text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                title="Export high-end laboratory certificate"
              >
                <FileCode size={12} className="text-slate-500" /> Export PDF/Doc
              </button>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
