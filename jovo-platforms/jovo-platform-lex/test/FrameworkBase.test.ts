import {
  LogLevel,
  HandleRequest,
  JovoRequest,
  TestSuite,
  SessionConstants,
  EnumRequestType,
  Jovo,
} from 'jovo-core';
import { App, ExpressJS } from 'jovo-framework';
import { FileDb2 } from 'jovo-db-filedb';
import _set = require('lodash.set');
import * as fs from 'fs';
import * as path from 'path';

import { Lex } from '../src';

const PATH_TO_DB_DIR = './test/db';

process.env.NODE_ENV = 'UNIT_TEST';
let app: App;
let t: TestSuite;
jest.setTimeout(600);
const delay = (ms: number) => {
  return new Promise((r) => setTimeout(r, ms));
};

beforeEach(() => {
  app = new App({
    user: {
      sessionData: {
        enabled: true,
        id: true,
      },
    },
  });
  const lex = new Lex();
  app.use(
    new FileDb2({
      path: PATH_TO_DB_DIR,
    }),
    lex,
  );
  t = lex.makeTestSuite();
});

afterAll(async () => {
  /**
   * Tests finish before the last FileDb JSON file is saved in the `db` folder.
   * That resulted in JSON files still being present after tests were finished.
   * Since the tests don't depend on the JSOn files being saved, it doesn't really matter,
   * but to always keep the db folder clear,
   * we set a small delay (500ms) before we clear the folder.
   */
  await delay(400);
  clearDbFolder();
});

describe('test request types', () => {
  test('test intent', async (done) => {
    app.setHandler({
      HelloWorldIntent() {},
    });

    const request: JovoRequest = await t.requestBuilder.intent('HelloWorldIntent', {});
    app.on('response', (handleRequest: HandleRequest) => {
      expect(handleRequest.jovo!.$type.type).toBe(EnumRequestType.INTENT);
      done();
    });
    await app.handle(ExpressJS.dummyRequest(request));
  });

  test('test end', async (done) => {
    app.setHandler({
      END() {
        this.tell('end');
      },
    });

    const request: JovoRequest = await t.requestBuilder.end();

    app.on('response', (handleRequest: HandleRequest) => {
      // @ts-ignore
      expect(handleRequest.jovo!.$response.dialogAction.type).toBe('Close');
      done();
    });
    await app.handle(ExpressJS.dummyRequest(request));
  });

  test('test end global', async (done) => {
    app.setHandler({
      END() {
        done();
      },
    });

    const request: JovoRequest = await t.requestBuilder.end();
    request.setState('State');
    await app.handle(ExpressJS.dummyRequest(request));
  });

  test('test getRoute', async (done) => {
    app.setHandler({
      HelloWorldIntent() {
        const route = this.getRoute();
        expect(route.type).toEqual('INTENT');
        expect(route.intent).toEqual('HelloWorldIntent');
        this.$session.$data.toto = 1;
        this.$user.$data.toto = 1;
        done();
      },
    });
    const request: JovoRequest = await t.requestBuilder.intent('HelloWorldIntent', {});
    app.on('response', (handleRequest: HandleRequest) => {
      // @ts-ignore
      const lexResponse = handleRequest.jovo!.$response;
      done();
    });
    await app.handle(ExpressJS.dummyRequest(request));
  });

  test('test end in state', async (done) => {
    app.setHandler({
      State: {
        END() {
          done();
        },
      },
    });

    const request: JovoRequest = await t.requestBuilder.end();
    request.setState('State');
    await app.handle(ExpressJS.dummyRequest(request));
  });

  test('test end in multilevel state', async (done) => {
    app.setHandler({
      State1: {
        State2: {
          END() {
            done();
          },
        },
      },
    });

    const request: JovoRequest = await t.requestBuilder.end();
    request.setState('State1.State2');
    await app.handle(ExpressJS.dummyRequest(request));
  });
});

describe('test state', () => {
  test('test getState', async (done) => {
    app.setHandler({
      TestState: {
        SessionIntent() {
          expect(this.getState()).toBe('TestState');
          done();
        },
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('SessionIntent', {});
    intentRequest.setSessionAttributes({
      [SessionConstants.STATE]: 'TestState',
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });

  test('test keep state', async (done) => {
    app.setHandler({
      TestState: {
        SessionIntent() {
          this.ask('Hello', 'World');
        },
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('SessionIntent', {});
    intentRequest.setSessionAttributes({
      [SessionConstants.STATE]: 'TestState',
    });
    app.on('response', (handleRequest: HandleRequest) => {
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute(SessionConstants.STATE, 'TestState'),
      ).toBe(true);
      done();
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });

  test('test removeState', async (done) => {
    app.setHandler({
      TestState: {
        SessionIntent() {
          this.removeState();
          this.ask('Hello', 'World');
        },
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('SessionIntent', {});
    intentRequest.setSessionAttributes({
      [SessionConstants.STATE]: 'TestState',
    });
    app.handle(ExpressJS.dummyRequest(intentRequest));

    app.on('response', (handleRequest: HandleRequest) => {
      expect(handleRequest.jovo!.$response!.hasSessionAttribute(SessionConstants.STATE)).toBe(
        false,
      );
      done();
    });
  });

  test('test setState', async (done) => {
    app.setHandler({
      TestState: {
        SessionIntent() {
          this.setState('AnotherTestState');
          this.ask('Hello', 'World');
        },
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('SessionIntent', {});
    intentRequest.setSessionAttributes({
      [SessionConstants.STATE]: 'TestState',
    });

    app.on('response', (handleRequest: HandleRequest) => {
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute(
          SessionConstants.STATE,
          'AnotherTestState',
        ),
      ).toBe(true);
      done();
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });
});

describe('test handleOnNewSession', () => {
  test('test no new session', async (done) => {
    app.setHandler({
      NEW_SESSION() {
        // shouldn't be reached
        this.$data.foo = 'bar';
      },
      IntentA() {
        expect(this.$data.foo).toBe(undefined);
        this.ask('intent');
        done();
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('IntentA', {});
    intentRequest.setNewSession(false);
    /* const dbJson = {
      userData: {
        data: {},
        session: {
          id: intentRequest.getSessionId(),
          lastUpdatedAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(`${PATH_TO_DB_DIR}/${intentRequest.getUserId()}.json`, JSON.stringify(dbJson));*/
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });

  test('test new session', async (done) => {
    app.setHandler({
      NEW_SESSION() {
        // should be reached
        this.$data.foo = 'bar';
      },
      IntentA() {
        expect(this.$data.foo).toBe('bar');
        this.ask('intent');
        done();
      },
    });
    const intentRequest: JovoRequest = await t.requestBuilder.intent('IntentA', {});
    const dbJson = {
      userData: {
        data: {},
        session: {},
      },
    };
    fs.writeFileSync(`${PATH_TO_DB_DIR}/${intentRequest.getUserId()}.json`, JSON.stringify(dbJson));
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });
});

describe('test session attributes', () => {
  test('test get session', async (done) => {
    app.setHandler({
      SessionIntent() {
        expect(this.getSessionAttribute('sessionName1')).toBe('sessionValue1');
        expect(this.$session!.$data.sessionName2).toBe('sessionValue2');

        this.ask('Foo', 'Bar');
        done();
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('SessionIntent', {});
    intentRequest.setSessionAttributes({
      sessionName1: 'sessionValue1',
      sessionName2: 'sessionValue2',
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });

  test('test set session', async (done) => {
    app.setHandler({
      LAUNCH() {
        this.setSessionAttribute('sessionName1', 'sessionValue1');
        this.addSessionAttribute('sessionName2', 'sessionValue2');
        this.$session!.$data.sessionName3 = 'sessionValue3';
        this.ask('Foo', 'Bar');
      },
    });

    const launchRequest: JovoRequest = await t.requestBuilder.launch();

    app.on('response', (handleRequest: HandleRequest) => {
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName1', 'sessionValue1'),
      ).toBe(true);
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName2', 'sessionValue2'),
      ).toBe(true);
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName3', 'sessionValue3'),
      ).toBe(true);

      done();
    });
    await app.handle(ExpressJS.dummyRequest(launchRequest));
  });

  test('test setSessionAttributes', async (done) => {
    app.setHandler({
      LAUNCH() {
        this.setSessionAttributes({
          sessionName1: 'sessionValue1',
          sessionName2: 'sessionValue2',
          sessionName3: 'sessionValue3',
        });
        this.ask('Foo', 'Bar');
      },
    });

    const launchRequest: JovoRequest = await t.requestBuilder.launch();
    app.handle(ExpressJS.dummyRequest(launchRequest));

    app.on('response', (handleRequest: HandleRequest) => {
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName1', 'sessionValue1'),
      ).toBe(true);
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName2', 'sessionValue2'),
      ).toBe(true);
      expect(
        handleRequest.jovo!.$response!.hasSessionAttribute('sessionName3', 'sessionValue3'),
      ).toBe(true);
      done();
    });
  });
});

describe('test $inputs', () => {
  test('test getInput, $inputs', async (done) => {
    app.setHandler({
      HelloWorldIntent() {
        expect(this.getInput('name')!.value).toBe('Joe');
        expect(this.$inputs!.name.value).toBe('Joe');
        done();
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('HelloWorldIntent', {
      name: 'Joe',
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  });

  test('test mapInputs', async (done) => {
    app.setConfig({
      inputMap: {
        'given-name': 'name',
      },
    });
    app.setHandler({
      HelloWorldIntent() {
        expect(this.getInput('name')!.value).toBe('Joe');
        expect(this.$inputs!.name.value).toBe('Joe');
        done();
      },
    });

    const intentRequest: JovoRequest = await t.requestBuilder.intent('HelloWorldIntent', {
      'given-name': 'Joe',
    });
    await app.handle(ExpressJS.dummyRequest(intentRequest));
  }, 100);
});

export function clearDbFolder() {
  const files = fs.readdirSync(PATH_TO_DB_DIR);

  files.forEach((file) => {
    fs.unlinkSync(path.join(PATH_TO_DB_DIR, file));
  });
}
