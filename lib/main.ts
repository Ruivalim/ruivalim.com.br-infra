import { RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { PipelineProject, BuildSpec, LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { GitHubSourceAction, GitHubTrigger, CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { HttpsRedirect } from 'aws-cdk-lib/aws-route53-patterns';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export default class RuivalimComBrInfra extends Stack {
	constructor(scope: Construct, id: string, props: StackProps) {
		super(scope, id, props);

		const domainName = 'ruivalim.com.br';

		const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
			domainName,
		});

		const certificate = new DnsValidatedCertificate(this, 'Certificate', {
			domainName,
			hostedZone,
			region: 'us-east-1',
			subjectAlternativeNames: [domainName, `*.${domainName}`],
		});

		const hostBucket = new Bucket(this, 'HostBucket', {
			bucketName: `ruivalim-com-br`,
			websiteIndexDocument: 'index.html',
			websiteErrorDocument: 'index.html',
			removalPolicy: RemovalPolicy.DESTROY,
		});

		const hostDistribution = new Distribution(this, 'HostApp', {
			domainNames: [domainName],
			defaultRootObject: 'index.html',
			certificate,
			defaultBehavior: { origin: new S3Origin(hostBucket), viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS },
		});

		new ARecord(this, 'ARecord', {
			zone: hostedZone,
			target: RecordTarget.fromAlias(new CloudFrontTarget(hostDistribution)),
			recordName: domainName,
		});

		new HttpsRedirect(this, 'HttpsRedirect', {
			recordNames: [`www.${domainName}`],
			targetDomain: domainName,
			zone: hostedZone,
		});

		const outputSource = new Artifact();

		const codebuild = new PipelineProject(this, 'WebsiteBuild', {
			projectName: 'RuivalimComBr',
			buildSpec: BuildSpec.fromSourceFilename('./buildspec.yml'),
			environment: {
				buildImage: LinuxBuildImage.STANDARD_5_0,
			},
			environmentVariables: {
				BUCKET_NAME: {
					value: hostBucket.bucketName,
				},
				CLOUDFRONT_ID: {
					value: hostDistribution.distributionId,
				},
			},
		});

		hostBucket.grantReadWrite(codebuild);
		hostBucket.grantPutAcl(codebuild);
		codebuild.addToRolePolicy(
			new PolicyStatement({
				actions: ['cloudfront:*'],
				resources: [`arn:aws:cloudfront::${process.env.CDK_DEFAULT_ACCOUNT}:distribution/${hostDistribution.distributionId}`],
			}),
		);
		codebuild.addToRolePolicy(
			new PolicyStatement({
				actions: ['logs:*'],
				resources: [`*`],
			}),
		);

		const pipeline = new Pipeline(this, 'UIPipeline', {
			pipelineName: 'RuivalimComBr',
		});

		pipeline.addStage({
			stageName: 'Source',
			actions: [
				new GitHubSourceAction({
					actionName: 'Source',
					owner: 'Ruivalim',
					repo: 'ruivalim.com.br',
					branch: 'main',
					oauthToken: SecretValue.secretsManager('ruivalimcombr/prod', { jsonField: 'GITHUB_TOKEN' }),
					output: outputSource,
					trigger: GitHubTrigger.WEBHOOK,
				}),
			],
		});

		pipeline.addStage({
			stageName: 'BuildAndDeploy',
			actions: [
				new CodeBuildAction({
					actionName: 'BuildAndDeploy',
					project: codebuild,
					input: outputSource,
				}),
			],
		});
	}
}
