import { ApplicationContract } from '@ioc:Adonis/Core/Application'

/**
 * Provider to bind bull to the container
 */
export default class BullProvider {
  constructor(protected app: ApplicationContract) {}

  public register() {
    this.app.container.bind('Rocketseat/Bull/BullExceptionHandler', () => {
      const { BullExceptionHandler } = require('../src/BullExceptionHandler')
      return BullExceptionHandler
    })

    this.app.container.singleton('Rocketseat/Bull', () => {
      const config = this.app.container
        .use('Adonis/Core/Config')
        .get('bull', {})
      const Logger = this.app.container.use('Adonis/Core/Logger')

      const { BullManager } = require('../src/BullManager')

      return new BullManager(this.app.container, Logger, config, [])
    })

    this.app.container.alias('Rocketseat/Bull', 'Bull')
  }

  public async boot() {
    const BullManager = this.app.container.use('Rocketseat/Bull')
    const jobs = require(this.app.startPath('jobs'))?.default || []
    jobs.forEach((path) => {
      const job = this.app.container.make(path)
      BullManager.addProcessor(job.key, job)
    })
  }

  public async shutdown() {
    await this.app.container
      .use<'Rocketseat/Bull'>('Rocketseat/Bull')
      .shutdown()
  }
}
