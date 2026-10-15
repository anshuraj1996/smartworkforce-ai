import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

// A canvas that owns one Chart.js instance: builds it once the view exists, rebuilds it when
// the config input changes, destroys it with the component. Lets lazily-rendered tabs use
// charts without each parent juggling ViewChild canvases and chart lifecycles.
@Component({
  selector: 'app-mini-chart',
  standalone: true,
  template: '<div class="mini-chart" [style.height.px]="height"><canvas #canvas></canvas></div>',
  styles: ['.mini-chart { position: relative; width: 100%; }']
})
export class MiniChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) config!: ChartConfiguration;
  @Input() height = 260;
  @ViewChild('canvas') private canvas?: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(): void { this.render(); }
  ngOnDestroy(): void { this.chart?.destroy(); }

  private render(): void {
    if (!this.canvas || !this.config) return;
    this.chart?.destroy();
    this.chart = new Chart(this.canvas.nativeElement, {
      ...this.config,
      options: { responsive: true, maintainAspectRatio: false, ...(this.config.options || {}) }
    });
  }
}
