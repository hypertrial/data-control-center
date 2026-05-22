import type { DependencyList, RefObject } from 'react'
import { useEffect, useRef } from 'react'
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
  const chartRef = useRef<echarts.ECharts | null>(null)
  const skipNextOptionUpdateRef = useRef(false)

  useEffect(() => {
    if (!enabled || !containerRef.current) return
    const el = containerRef.current
    const chart = echarts.init(el)
    chartRef.current = chart
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.setOption({ animation: !reduce, ...buildOption() })
    skipNextOptionUpdateRef.current = true
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
      chartRef.current = null
      skipNextOptionUpdateRef.current = false
    }
    // Keep the ECharts instance stable; option updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register/buildOption changes should not recreate the chart
  }, [enabled, containerRef])

  useEffect(() => {
    const chart = chartRef.current
    if (!enabled || !chart) return
    if (skipNextOptionUpdateRef.current) {
      skipNextOptionUpdateRef.current = false
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.setOption({ animation: !reduce, ...buildOption() })
    // Callers pass `deps`; omitting unstable callbacks avoids unnecessary option writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps boundary for chart updates
  }, [enabled, containerRef, ...deps])
}
