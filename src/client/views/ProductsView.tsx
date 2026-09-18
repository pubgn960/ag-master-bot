import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Package, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const ProductsView: React.FC = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Login Types</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure dynamic fields, validation rules (Activision email/phone vs Facebook phone with country code), .
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading definitions...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {products.map((p) => (
            <Card key={p.id} title={p.name} subtitle={`Login Type Code: ${p.code}`}>
              <div className="space-y-4 text-xs">
                {/* Rules Alert */}
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1">
                  <p className="font-bold text-cyan-400 font-mono text-[11px]">Field Validation Rules:</p>
                  <p className="text-slate-300">
                    {p.code === 'ACTIVISION'
                      ? 'Requires Email and Password.'
                      : 'Requires Phone with international country code (+...) and Password. Email is strictly prohibited.'}
                  </p>
                </div>

                {/* Required Fields */}
                <div>
                  <p className="font-bold text-slate-400 uppercase tracking-wider text-[10px] mb-2">Required Fields:</p>
                  <div className="space-y-1.5">
                    {p.fields?.map((f: any) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-2 bg-slate-950/50 border border-slate-800/80 rounded-lg"
                      >
                        <div>
                          <span className="font-semibold text-slate-200">{f.field_label}</span>
                          <span className="text-slate-500 font-mono text-[10px] ml-2">({f.field_name})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {f.is_secret && (
                            <Badge variant="purple" size="sm">
                              Encrypted AES-256
                            </Badge>
                          )}
                          {f.is_required && (
                            <Badge variant="info" size="sm">
                              Required
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
