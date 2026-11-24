/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Ignore third-party extension errors (e.g. MetaMask)
    if (
      error?.message?.includes('MetaMask') ||
      error?.stack?.includes('chrome-extension://') ||
      error?.stack?.includes('inpage.js')
    ) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (
      error?.message?.includes('MetaMask') ||
      error?.stack?.includes('chrome-extension://') ||
      error?.stack?.includes('inpage.js')
    ) {
      return;
    }
    console.error('Uncaught error in Mizan:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-950/80 border border-amber-800 text-amber-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">حدث خطأ غير متوقع</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              واجه التطبيق استثناءً غير متوقع في العرض. يمكنك النقر على الزر أدناه لإعادة تحميل الصفحة واستعادة حالة العمل.
            </p>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              إعادة تحميل المنصة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
