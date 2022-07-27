import { ApplicationContract } from '@ioc:Adonis/Core/Application'
import { Application } from '@adonisjs/application'
/**
 * Provider to bind bull to the container
 */
export default class BullProvider {
  public static needsApplication: boolean = true

  protected container: ApplicationContract['container']

  constructor(protected app: Application) {
    this.container = app.container
  }

  public register() {
    if (this.app.environment === 'web') {
      this.container.bind('Rocketseat/Bull/BullExceptionHandler', () => {
        const { BullExceptionHandler } = require('../src/BullExceptionHandler')
        return BullExceptionHandler
      })

      this.container.singleton('Rocketseat/Bull', () => {
        const config = this.container.use('Adonis/Core/Config').get('bull', {})
        const Logger = this.container.use('Adonis/Core/Logger')

        const { BullManager } = require('../src/BullManager')

        return new BullManager(this.container, Logger, config, [])
      })

      this.container.alias('Rocketseat/Bull', 'Bull')
    }
  }

  public async boot() {
    if (this.app.environment === 'web') {
      const BullManager = this.container.use('Rocketseat/Bull')
      const jobs = require(this.app.startPath('jobs'))?.default || []
      jobs.forEach((path) => {
        const job = this.container.make(path)
        BullManager.addProcessor(job.key, job)
      })
    }
  }

  public async shutdown() {
    if (this.app.environment === 'web') {
      await this.container.use<'Rocketseat/Bull'>('Rocketseat/Bull').shutdown()
    }
  }
}
