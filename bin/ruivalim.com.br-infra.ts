#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import 'source-map-support/register';
import RuivalimComBrInfra from '../lib/main';

const app = new App();

new RuivalimComBrInfra(app, 'RuivalimComBrInfra', {
	env: {
		region: process.env.CDK_DEFAULT_REGION,
		account: process.env.CDK_DEFAULT_ACCOUNT,
	},
});
