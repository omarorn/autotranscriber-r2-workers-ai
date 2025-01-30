import { WorkerEntrypoint } from 'cloudflare:workers';
// @ts-ignore
import { Buffer } from 'node:buffer';

export type Upload = {
	url: string;
	metadata: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output;
};

export class Uploader extends WorkerEntrypoint<Env> {
	async listUploads() {
		const keyList = await this.env.METADATA.list();
		return keyList.keys.map((k) => k.name).sort();
	}

	async getUpload(key: string): Promise<Upload> {
		const obj = await this.env.UPLOADS.head(key);
		if (obj === null) {
			throw new Error(`Upload not found: ${key}`);
		}
		const metadataJSON = await this.env.METADATA.get(key);
		const metadata: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output = JSON.parse(metadataJSON as string);
		return {
			url: `${this.env.R2_URL}/${encodeURIComponent(key)}`,
			metadata,
		};
	}

	async deleteUpload(key: string) {
		await this.env.UPLOADS.delete(key);
		await this.env.METADATA.delete(key);
		console.log(`Deleted ${key}`);
	}
}

/**
 * The body of an R2 Event Notification sent to a Queue
 */
type R2EventNotification = {
	/**
	 * The owner of the R2 Bucket.
	 */
	account: string;
	/**
	 * The name of the R2 Bucket.
	 */
	bucket: string;
	/**
	 * The time when the R2 action took place.
	 */
	eventTime: Date;
} & (
	| {
			/**
			 * The R2 action that triggered the Event Notification rule.
			 */
			action: 'PutObject';
			object: {
				/**
				 * The name of the object that triggered the Event Notification rule.
				 */
				key: string;
				/**
				 * The object size in bytes.
				 */
				size: number;
				/**
				 * The object eTag.
				 */
				eTag: string;
			};
	  }
	| {
			action: 'DeleteObject';
			object: {
				key: string;
			};
	  }
	| {
			action: 'CompleteMultipartUpload';
			object: {
				key: string;
				size: number;
				eTag: string;
			};
	  }
	| {
			action: 'AbortMultipartUpload';
			object: {
				key: string;
			};
	  }
	| {
			action: 'CopyObject';
			object: {
				key: string;
				size: number;
				eTag: string;
			};
			/**
			 * The name of the bucket and object that an R2 object was copied from.
			 */
			copySource: {
				bucket: string;
				object: string;
			};
	  }
	| {
			action: 'LifecycleDeletion';
			object: {
				key: string;
			};
	  }
);

export default {
	async fetch() {
		return new Response('nobody home');
	},
	async queue(batch: MessageBatch<R2EventNotification>, env: Env) {
		// Get message
		for (const msg of batch.messages) {
			const payload = msg.body;
			switch (payload.action) {
				case 'PutObject':
					const fileUpload = await env.UPLOADS.get(payload.object.key);
					if (fileUpload === null) {
						break;
					}
					const aBuffer = await fileUpload.arrayBuffer();
					const base64String = Buffer.from(aBuffer).toString('base64');
					const results = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
						audio: base64String,
					});
					console.log('Storing transcription in metadata', results);
					await env.METADATA.put(payload.object.key, JSON.stringify(results));
					break;
				case 'DeleteObject':
					console.log("Removing transcription", payload.object.key);
					await env.METADATA.delete(payload.object.key);
					break;
				default:
					console.warn(`Unhandled action: ${payload.action}`);
			}
			msg.ack();
		}
	},
};
