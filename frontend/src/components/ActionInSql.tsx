import type { ReactNode } from 'react'
import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import { useOpenInSql } from '@/hooks/useOpenInSql'

export function ActionInSql({
  sql,
  children,
  ...btn
}: { sql: string; children: ReactNode } & Omit<ButtonProps, 'onClick' | 'type'>) {
  const open = useOpenInSql()
  return (
    <Button type="button" {...btn} onClick={() => open(sql)}>
      {children}
    </Button>
  )
}
