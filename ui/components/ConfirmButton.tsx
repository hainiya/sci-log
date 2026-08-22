import { useEffect, useRef, useState } from 'react';

type Props = {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  title?: string;
  timeoutMs?: number;
};

/**
 * 两步确认按钮：第一次点击进入待确认态（红色），再次点击才真正执行。
 * 超时未确认自动还原，避免误触删除。
 */
export function ConfirmButton({ label, confirmLabel = '确认？', onConfirm, className = '', title, timeoutMs = 3500 }: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleClick = async () => {
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), timeoutMs);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    await onConfirm();
  };

  return (
    <button
      className={`${className} ${armed ? 'mrc-btn-armed' : ''}`}
      title={armed ? '再次点击确认执行' : title}
      onClick={handleClick}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
