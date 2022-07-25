import { IocContract } from '@adonisjs/fold'
import { LoggerContract } from '@ioc:Adonis/Core/Logger'

import {
  BullManagerContract,
  JobContract,
  QueueContract,
  BullConfig,
  EventListener,
  QueueOptions,
} from '@ioc:Rocketseat/Bull'

import {
  Queue,
  QueueScheduler,
  JobsOptions,
  Job as BullJob,
  Worker,
  WorkerOptions,
  Processor,
  WorkerListener,
} from 'bullmq'
import { createBullBoard } from '@bull-board/api'
import { ExpressAdapter } from '@bull-board/express'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'

export class BullManager implements BullManagerContract {
  constructor(
    protected container: IocContract,
    protected Logger: LoggerContract,
    protected config: BullConfig,
    protected jobs: string[]
  ) {}

  private _queues: { [key: string]: QueueContract }
  private _shutdowns: (() => Promise<any>)[] = []

  public get queues() {
    if (this._queues) {
      return this._queues
    }

    this._queues = {}
    return this.queues
  }

  public addProcessor(key: string, job: JobContract) {
    if (!this.queues[key]) {
      const queueConfig: QueueOptions = {
        connection: this.config.connections[this.config.connection],
        defaultJobOptions: job.options,
        ...job.queueOptions,
      }

      const jobListeners = this._getEventListener(job)

      // eslint-disable-next-line no-new
      new QueueScheduler(job.key, queueConfig)

      this.queues[job.key] = Object.freeze({
        bull: new Queue(job.key, queueConfig),
        ...job,
        instance: job,
        listeners: jobListeners,
        boot: job.boot,
      })
    }
  }

  private _getEventListener(job: JobContract): EventListener[] {
    const jobListeners = Object.getOwnPropertyNames(
      Object.getPrototypeOf(job)
    ).reduce((events, method: string) => {
      if (method.startsWith('on')) {
        const eventName = method
          .replace(/^on(\w)/, (_, group) => group.toLowerCase())
          .replace(
            /([A-Z]+)/,
            (_, group) => ` ${group.toLowerCase()}`
          ) as keyof WorkerListener

        events.push({ eventName, method })
      }

      return events
    }, [] as EventListener[])

    return jobListeners
  }

  public getByKey(key: string): QueueContract {
    return this.queues[key]
  }

  public add<T>(
    key: string,
    data: T,
    jobOptions?: JobsOptions
  ): Promise<BullJob<any, any>> {
    return this.getByKey(key).bull.add(key, data, jobOptions)
  }

  public schedule<T = any>(
    key: string,
    data: T,
    date: number | Date,
    options?: JobsOptions
  ) {
    const delay = typeof date === 'number' ? date : date.getTime() - Date.now()

    if (delay <= 0) {
      throw new Error('Invalid schedule time')
    }

    return this.add(key, data, { ...options, delay })
  }

  public async remove(key: string, jobId: string): Promise<void> {
    const job = await this.getByKey(key).bull.getJob(jobId)
    return job?.remove()
  }

  /* istanbul ignore next */
  public ui(port = 9999) {
    const serverAdapter = new ExpressAdapter()
    createBullBoard({
      queues: Object.keys(this.queues).map(
        (key) => new BullMQAdapter(this.getByKey(key).bull)
      ),
      serverAdapter: serverAdapter,
    })

    const server = serverAdapter.getRouter().listen(port, () => {
      this.Logger.info(`bull board on http://localhost:${port}`)
    })

    const shutdown = async () => {
      await server.close(() => {
        this.Logger.info('Stopping bull board server')
      })
    }

    this._shutdowns = [...this._shutdowns, shutdown]
  }

  public process() {
    this.Logger.info('Queue processing started')

    const shutdowns = Object.keys(this.queues).map((key) => {
      const jobDefinition = this.getByKey(key)

      if (typeof jobDefinition.boot !== 'undefined') {
        jobDefinition.boot(jobDefinition.bull)
      }

      const workerOptions: WorkerOptions = {
        concurrency: jobDefinition.concurrency ?? 1,
        connection: this.config.connections[this.config.connection],
        ...jobDefinition.workerOptions,
      }

      const processor: Processor = async (job) => {
        try {
          return await jobDefinition.instance.handle(job)
        } catch (error) {
          await this.handleException(error, job)
          return Promise.reject(error)
        }
      }

      const worker = new Worker(key, processor, workerOptions)

      jobDefinition.listeners.forEach(function (item) {
        worker.on(
          item.eventName,
          jobDefinition.instance[item.method].bind(jobDefinition.instance)
        )
      })

      const shutdown = () =>
        Promise.all([jobDefinition.bull.close(), worker.close()])

      return shutdown
    })

    this._shutdowns = [...this._shutdowns, ...shutdowns]

    return this
  }

  private async handleException(error, job) {
    try {
      const resolver = this.container.getResolver(
        undefined,
        'exceptions',
        'App/Exceptions'
      )

      const resolvedPayload = resolver.resolve('BullHandler.handle')

      await resolver.call(resolvedPayload, undefined, [error, job])
    } catch (err) {
      this.Logger.error(`name=${job.name} id=${job.id}`)
    }
  }

  public async shutdown() {
    await Promise.all(this._shutdowns.map((shutdown) => shutdown()))
  }
}
