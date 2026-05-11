import type { DependencyList, RefObject } from 'react'
import { useEffect } from 'react'
import * as echarts from 'echarts'
import type { EChartsCoreOption } from 'echarts'

export type EChartsRegister = (chart: echarts.ECharts) => void | (() => void)

/**
 * Mount one ECharts instance on `containerRef`, apply options from `buildOption`, dispose on cleanup.
 * Optional `register` runs after setOption; return a function for teardown before dispose (e.g. off events).
 */
export function useDisposableEChart(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  buildOption: () => EChartsCoreOption,
  deps: DependencyList,
  register?: EChartsRegister,
): void {
  useEffect(() => {
    if (!enabled || !containerRef.current) return
    const el = containerRef.current
    const chart = echarts.init(el)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.setOption({ animation: !reduce, ...buildOption() })
    let extraCleanup: void | (() => void)
    if (register) {
      const out = register(chart)
      if (typeof out === 'function') extraCleanup = out
    }
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      extraCleanup?.()
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
    // Callers pass `deps`; omitting unstable callbacks avoids tearing charts down every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps boundary for chart lifecycle
  }, [enabled, containerRef, ...deps])
}
