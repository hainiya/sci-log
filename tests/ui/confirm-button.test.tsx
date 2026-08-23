import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfirmButton } from '../../ui/components/ConfirmButton';

describe('ConfirmButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('第一次点击进入确认态，再次点击才触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="删" confirmLabel="确认删除" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('删'));
    expect(screen.getByText('确认删除')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认删除'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('超过 timeoutMs 未确认会自动还原', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="删" onConfirm={onConfirm} timeoutMs={1000} />);
    fireEvent.click(screen.getByText('删'));
    expect(screen.getByText('确认？')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByText('删')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
