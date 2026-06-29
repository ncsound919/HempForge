import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileCheck2, 
  Bot, 
  Settings,
  Leaf,
  Database,
  Beaker,
  GitMerge,
} from 'lucide-react';

export default function Sidebar() {
  const location = useLocation();
  const activeTab = location.pathname;

  const navItems = [
    { id: '/', label: 'Dashboard', icon: LayoutDashboard },
    { id: '/intake', label: 'COA Intake & Audit', icon: FileCheck2 },
    { id: '/agent', label: 'Swarm Agents', icon: Bot },
    { id: '/agent-workspace', label: 'Agentic Workspace', icon: Bot },
    { id: '/vault', label: 'Knowledge Vault', icon: Database },
    { id: '/lab', label: 'Research Lab', icon: Beaker },
    { id: '/workflows', label: 'Workflows & ROI', icon: GitMerge },
    { id: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[#0D1411] border-r border-white/10 h-screen flex flex-col pt-6 pb-4 z-10 sticky top-0">
      <div className="px-6 mb-8 flex items-center gap-3">
        <div className="bg-emerald-500 p-2 text-[#0A0F0D]">
          <Leaf size={24} />
        </div>
        <div>
          <h1 className="font-bold text-xl text-white tracking-tight">HempForge <span className="text-emerald-500 font-mono text-[10px] ml-1 uppercase tracking-widest">v0.1</span></h1>
          <p className="text-[10px] text-emerald-500 font-mono uppercase tracking-widest mt-1">Agentic Compliance</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id || (item.id !== '/' && activeTab.startsWith(item.id));
          return (
            <Link
              key={item.id}
              to={item.id}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-none text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/5 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
              }`}
            >
              <item.icon size={18} className={isActive ? 'text-emerald-500' : 'text-slate-500'} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 mt-auto">
        <div className="bg-white/5 rounded-none p-4 border-l-2 border-emerald-500">
          <h4 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] mb-3">System Status</h4>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300 mb-2">
            <span className="w-2 h-2 bg-emerald-500"></span>
            LangGraph: Online
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
            <span className="w-2 h-2 bg-emerald-500"></span>
            Compliance DB: Synced
          </div>
        </div>
      </div>
    </aside>
  );
}
