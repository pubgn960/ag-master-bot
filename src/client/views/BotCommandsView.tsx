import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Terminal, Shield, CheckCircle2, XCircle, FileCode } from 'lucide-react';

export const BotCommandsView: React.FC = () => {
  const [selectedCmd, setSelectedCmd] = useState<any>(null);
  const [commands, setCommands] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCmds = async () => {
      setLoading(true);
      try {
        let res = await fetch('/api/bot-commands');
        if (!res.ok) res = await fetch('/api/config/commands');
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.commands) ? data.commands : [];
        setCommands(list);
      } catch (e) {
        console.error('Failed to load commands:', e);
      }
      setLoading(false);
    };
    fetchCmds();
  }, []);

  const customerCommands = commands.filter(c => c.category === 'CUSTOMER');
  const ownerStaffUtility = commands.filter(c => c.category === 'OWNER_STAFF_UTILITY');
  const teamCommands = commands.filter(c => c.category === 'TEAM');

  const renderTable = (title: string, cmds: any[]) => (
    <Card title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-mono">
              <th className="pb-3 font-medium">COMMAND</th>
              <th className="pb-3 font-medium">DESCRIPTION</th>
              <th className="pb-3 font-medium">REQUIRED ROLE</th>
              <th className="pb-3 font-medium text-center">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-medium">
            {cmds.map((c) => (
              <tr 
                key={c.cmd} 
                className="hover:bg-slate-800/30 cursor-pointer transition-colors"
                onClick={() => setSelectedCmd(c)}
              >
                <td className="py-3 font-mono text-cyan-400 font-bold">{c.cmd}</td>
                <td className="py-3 text-slate-300">{c.desc}</td>
                <td className="py-3 text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> {c.role}
                  </div>
                </td>
                <td className="py-3 text-center">
                  <Badge 
                    variant={
                      c.classification === 'FUNCTIONAL' ? 'success' :
                      c.classification === 'READ-ONLY' ? 'info' :
                      c.classification === 'DASHBOARD HANDOFF' ? 'warning' :
                      c.classification === 'DISABLED' ? 'danger' : 'default'
                    } 
                    size="sm"
                  >
                    {c.classification}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Bot Commands Reference</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Registry of all Telegram commands parsed by the webhook handler. Click a command for details.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {renderTable('Customer-Facing Commands', customerCommands)}
          {renderTable('Owner & Staff Utilities', ownerStaffUtility)}
          {renderTable('Team Commands', teamCommands)}
        </div>
        
        <div>
          <Card title="Command Details">
            {selectedCmd ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                  <div className="p-2.5 bg-cyan-950/60 border border-cyan-800/80 rounded-lg text-cyan-400">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 font-mono">{selectedCmd.cmd}</h3>
                    <p className="text-xs text-slate-400">{selectedCmd.role}</p>
                  </div>
                </div>
                
                <div className="text-xs space-y-3">
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Purpose</span>
                    <p className="text-slate-300">{selectedCmd.desc}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Usage Syntax</span>
                    <code className="px-2 py-1 bg-slate-950 border border-slate-800 rounded font-mono text-cyan-300">
                      {selectedCmd.cmd} {selectedCmd.cmd === '/setprice' ? '[bundle] [price]' : ''}
                    </code>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Example</span>
                    <p className="text-slate-300 bg-slate-900/50 p-2 border border-slate-800 rounded font-mono">
                      {selectedCmd.cmd} {selectedCmd.cmd === '/setprice' ? '5000CP 29.99' : ''}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Implementation Status</span>
                    <span className={`flex items-center gap-1.5 font-semibold ${selectedCmd.classification === 'FUNCTIONAL' || selectedCmd.classification === 'READ-ONLY' ? 'text-emerald-400' : selectedCmd.classification === 'DASHBOARD HANDOFF' ? 'text-amber-400' : 'text-rose-400'}`}>
                        {selectedCmd.classification === 'FUNCTIONAL' || selectedCmd.classification === 'READ-ONLY' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {selectedCmd.classification}
                      </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                <FileCode className="w-8 h-8 mx-auto mb-3 opacity-50" />
                Select a command from the list to view implementation details and routing logic.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
