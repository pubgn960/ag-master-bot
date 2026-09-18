import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { FileText, Save, RotateCcw, Eye, CheckCircle2 } from 'lucide-react';

interface TemplateItem {
  type: string;
  name: string;
  content: string;
  allowedVars: string[];
  sampleVars: Record<string, string>;
}

const TEMPLATE_DEFINITIONS: Array<{ type: string; name: string; allowedVars: string[]; sampleVars: Record<string, string> }> = [
  {
    type: 'ORDER_PLACED',
    name: 'Customer Order Confirmation',
    allowedVars: [],
    sampleVars: {},
  },
  {
    type: 'FULL_PAYMENT',
    name: 'Full Payment Received',
    allowedVars: ['amount'],
    sampleVars: { amount: '28.50' },
  },
  {
    type: 'PARTIAL_PAYMENT',
    name: 'Partial Payment Received',
    allowedVars: ['amount', 'remaining'],
    sampleVars: { amount: '10.00', remaining: '18.50' },
  },
  {
    type: 'PAYMENT_REMINDER',
    name: 'Payment Reminder',
    allowedVars: ['remaining'],
    sampleVars: { remaining: '18.50' },
  },
  {
    type: 'MULTIPLE_ORDERS',
    name: 'Multiple Orders Notice',
    allowedVars: [],
    sampleVars: {},
  },
  {
    type: 'MISSING_FIELDS',
    name: 'Missing Required Fields Notice',
    allowedVars: [],
    sampleVars: {},
  },
  {
    type: 'PAYMENT_VERIFICATION',
    name: 'Payment Verification In-Progress',
    allowedVars: [],
    sampleVars: {},
  },
  {
    type: 'CANCELLATION',
    name: 'Order Cancellation Message',
    allowedVars: [],
    sampleVars: {},
  },
  {
    type: 'ORDER_COMPLETED',
    name: 'Order Completed Notification',
    allowedVars: ['productBundle', 'accountIdentifier', 'salePrice'],
    sampleVars: { productBundle: '10,800 CP', accountIdentifier: 'user@example.com', salePrice: '28.50' },
  },
  {
    type: 'WRONG_CREDENTIALS',
    name: 'Invalid Credentials Alert',
    allowedVars: ['bundleName'],
    sampleVars: { bundleName: '10,800 CP' },
  },
  {
    type: 'CREDENTIALS_UPDATED',
    name: 'Credentials Resubmission Confirmation',
    allowedVars: ['orderNumber'],
    sampleVars: { orderNumber: 'ORD-123' },
  },
  {
    type: 'ORDER_IN_PROGRESS',
    name: 'Order In Progress Notice',
    allowedVars: ['orderNumber', 'package'],
    sampleVars: { orderNumber: 'ORD-123', package: '10,800 CP' },
  },
  {
    type: 'CREDIT_HOLD_CLEARED',
    name: 'Credit Hold Cleared Notice',
    allowedVars: ['orderNumber'],
    sampleVars: { orderNumber: 'ORD-123' },
  },
  {
    type: 'CREDIT_LIMIT_EXCEEDED',
    name: 'Credit Limit Exceeded Hold',
    allowedVars: ['currentTab', 'orderAmount', 'creditLimit', 'orderNumber'],
    sampleVars: { currentTab: '80.00', orderAmount: '28.50', creditLimit: '100.00', orderNumber: 'ORD-123' },
  },
];

export const TemplatesView: React.FC = () => {
  const [templateMap, setTemplateMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Preview Modal
  const [previewModal, setPreviewModal] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, string> = {};
        data.forEach((row: any) => {
          map[row.template_type] = row.template_content;
        });
        setTemplateMap(map);
      }
    } catch (err: any) {
      setFeedback({ text: `Error loading templates: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleSave = async (type: string) => {
    try {
      const content = templateMap[type] || '';
      const res = await fetch(`/api/templates/${type}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSavedKey(type);
      setFeedback({ text: `Template ${type} saved and persisted to PostgreSQL.`, type: 'success' });
      setTimeout(() => setSavedKey(null), 2500);
    } catch (err: any) {
      setFeedback({ text: `Save failed: ${err.message}`, type: 'error' });
    }
  };

  const handleReset = async (type: string) => {
    if (!confirm(`Reset ${type} to official canonical default?`)) return;
    try {
      const res = await fetch(`/api/templates/${type}/reset`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset');

      setTemplateMap((prev) => ({
        ...prev,
        [type]: data.content,
      }));
      setFeedback({ text: `Template ${type} reset to canonical default.`, type: 'success' });
    } catch (err: any) {
      setFeedback({ text: `Reset failed: ${err.message}`, type: 'error' });
    }
  };

  const openPreview = (item: typeof TEMPLATE_DEFINITIONS[0]) => {
    let raw = templateMap[item.type] || '';
    // Substitute sample vars
    Object.entries(item.sampleVars).forEach(([k, v]) => {
      raw = raw.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
    });
    setPreviewTitle(item.name);
    setPreviewText(raw);
    setPreviewModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Message Templates</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure canonical customer confirmations and payment replies. Persisted to PostgreSQL through TemplateService.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading templates from database...</div>
      ) : (
        <div className="space-y-4">
          {TEMPLATE_DEFINITIONS.map((tpl) => {
            const currentContent = templateMap[tpl.type] !== undefined ? templateMap[tpl.type] : '';

            return (
              <Card key={tpl.type} title={tpl.name} subtitle={`Type: ${tpl.type}`}>
                <div className="space-y-3 text-xs font-sans">
                  <textarea
                    value={currentContent}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTemplateMap((prev) => ({
                        ...prev,
                        [tpl.type]: val,
                      }));
                    }}
                    rows={2}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 font-mono focus:outline-none focus:border-cyan-500 text-xs"
                  />
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-1">
                    <span className="text-[11px] text-slate-500 font-mono">
                      {tpl.allowedVars.length > 0
                        ? `Allowlisted variables: ${tpl.allowedVars.map((v) => `{{${v}}}`).join(', ')}`
                        : 'No variables allowed (Static notice)'}
                    </span>
                    <div className="flex items-center gap-2 self-end">
                      <button
                        type="button"
                        onClick={() => openPreview(tpl)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReset(tpl.type)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                        title="Reset to official canonical default"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSave(tpl.type)}
                        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savedKey === tpl.type ? 'Saved!' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Modal isOpen={previewModal} onClose={() => setPreviewModal(false)} title={`Preview: ${previewTitle}`} maxWidth="max-w-md">
        <div className="space-y-3 text-xs font-sans">
          <p className="text-slate-400 text-xs">Simulated Telegram chat message appearance:</p>
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-100 whitespace-pre-wrap">
            {previewText}
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setPreviewModal(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
