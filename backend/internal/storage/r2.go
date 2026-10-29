package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type R2Config struct {
	AccountID       string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Jurisdiction    string
}

type R2 struct {
	client *s3.Client
	bucket string
}

func NewR2(cfg R2Config) (*R2, error) {
	accountID := strings.TrimSpace(cfg.AccountID)
	bucket := strings.TrimSpace(cfg.Bucket)
	accessKeyID := strings.TrimSpace(cfg.AccessKeyID)
	secret := strings.TrimSpace(cfg.SecretAccessKey)
	if accountID == "" || bucket == "" || accessKeyID == "" || secret == "" {
		return nil, errors.New("R2 配置不完整")
	}

	host := accountID + ".r2.cloudflarestorage.com"
	if cfg.Jurisdiction == "eu" {
		host = accountID + ".eu.r2.cloudflarestorage.com"
	}
	client := s3.New(s3.Options{
		Region:       "auto",
		Credentials:  credentials.NewStaticCredentialsProvider(accessKeyID, secret, ""),
		BaseEndpoint: aws.String("https://" + host),
		UsePathStyle: true,
	})
	return &R2{client: client, bucket: bucket}, nil
}

func (r *R2) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(r.bucket),
		Key:           aws.String(key),
		Body:          body,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
	})
	return err
}

func (r *R2) Exists(ctx context.Context, key string) (bool, error) {
	_, err := r.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(r.bucket), Key: aws.String(key)})
	if err == nil {
		return true, nil
	}
	if IsNotFound(err) {
		return false, nil
	}
	return false, err
}

func (r *R2) Get(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	out, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, 0, "", err
	}
	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	contentType := ""
	if out.ContentType != nil {
		contentType = *out.ContentType
	}
	return out.Body, size, contentType, nil
}

func (r *R2) Delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	return err
}

func (r *R2) Check(ctx context.Context) error {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	key := "_workbench/connection-test-" + hex.EncodeToString(buf)
	if err := r.Put(ctx, key, strings.NewReader("ok"), 2, "text/plain"); err != nil {
		return err
	}
	body, _, _, err := r.Get(ctx, key)
	if err != nil {
		return err
	}
	_, readErr := io.Copy(io.Discard, body)
	closeErr := body.Close()
	deleteErr := r.Delete(ctx, key)
	if readErr != nil {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	return deleteErr
}

func IsNotFound(err error) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound", "NoSuchBucket":
			return true
		}
	}
	return false
}
