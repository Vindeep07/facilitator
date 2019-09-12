import 'mocha';

import BigNumber from 'bignumber.js';

import Request from '../../../src/models/Request';
import Repositories from '../../../src/repositories/Repositories';
import assert from '../../test_utils/assert';
import StubData from '../../test_utils/StubData';
import Util from './util';
import { RequestType } from '../../../src/repositories/RequestRepository';

interface TestConfigInterface {
  repos: Repositories;
}
let config: TestConfigInterface;

describe('RequestRepository::getByMessageHash', (): void => {
  beforeEach(async (): Promise<void> => {
    config = {
      repos: await Repositories.create(),
    };
  });

  it('Checks retrieval of Request by messageHash.', async (): Promise<void> => {
    const messageHash = '0x00000000000000000000000000000000000000000000000000000000000000333';
    const message = StubData.messageAttributes(
      messageHash,
      '0x0000000000000000000000000000000000000001',
      new BigNumber(300),
    );
    await config.repos.messageRepository.save(
      message,
    );

    const request = StubData.getARequest('requestHash', RequestType.Stake);
    request.messageHash = messageHash;

    await config.repos.requestRepository.save(
      request,
    );

    const requestOutput = await config.repos.requestRepository.getByMessageHash(
      messageHash,
    );

    assert.notStrictEqual(
      requestOutput,
      null,
      'Stake/Redeem request should exists as it has been just created.',
    );

    Util.checkInputAgainstOutput(
      request,
      requestOutput as Request,
    );
  });

  it('Checks retrieval of non-existing Request by messageHash.', async (): Promise<void> => {
    const request = await config.repos.requestRepository.getByMessageHash(
      'nonExistingMessageHash',
    );

    assert.strictEqual(
      request,
      null,
      'Request with \'nonExistingMessageHash\' does not exist.',
    );
  });
});
