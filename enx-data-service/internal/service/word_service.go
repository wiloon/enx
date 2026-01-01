package service

import (
	"context"
	"time"

	"enx-data-service/internal/model"
	"enx-data-service/internal/repository"
	pb "enx-data-service/proto"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type WordService struct {
	pb.UnimplementedDataServiceServer
	repo *repository.WordRepository
}

func NewWordService(repo *repository.WordRepository) *WordService {
	return &WordService{repo: repo}
}

func (s *WordService) CreateWord(ctx context.Context, req *pb.CreateWordRequest) (*pb.CreateWordResponse, error) {
	now := time.Now().UnixMilli()
	word := &model.Word{
		ID:        uuid.New().String(),
		English:   req.English,
		CreatedAt: now,
		UpdatedAt: now,
		LoadCount: 0,
	}

	if req.Chinese != "" {
		word.Chinese = &req.Chinese
	}
	if req.Pronunciation != "" {
		word.Pronunciation = &req.Pronunciation
	}

	if err := s.repo.Create(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create word: %v", err)
	}

	return &pb.CreateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *WordService) GetWord(ctx context.Context, req *pb.GetWordRequest) (*pb.GetWordResponse, error) {
	word, err := s.repo.FindByID(req.Id)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "word not found: %v", err)
	}
	return &pb.GetWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *WordService) UpdateWord(ctx context.Context, req *pb.UpdateWordRequest) (*pb.UpdateWordResponse, error) {
	word, err := s.repo.FindByID(req.Word.Id)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "word not found: %v", err)
	}

	// Update fields from request
	if req.Word.English != "" {
		word.English = req.Word.English
	}
	if req.Word.Chinese != "" {
		chinese := req.Word.Chinese
		word.Chinese = &chinese
	}
	if req.Word.Pronunciation != "" {
		pronunciation := req.Word.Pronunciation
		word.Pronunciation = &pronunciation
	}

	word.UpdatedAt = time.Now().UnixMilli()

	if err := s.repo.Update(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update word: %v", err)
	}

	return &pb.UpdateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *WordService) DeleteWord(ctx context.Context, req *pb.DeleteWordRequest) (*pb.DeleteWordResponse, error) {
	if err := s.repo.SoftDelete(req.Id, time.Now().UnixMilli()); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete word: %v", err)
	}
	return &pb.DeleteWordResponse{Id: req.Id}, nil
}

func (s *WordService) ListWords(ctx context.Context, req *pb.ListWordsRequest) (*pb.ListWordsResponse, error) {
	words, err := s.repo.FindAll()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list words: %v", err)
	}

	protoWords := make([]*pb.Word, len(words))
	for i, w := range words {
		protoWords[i] = convertModelToProto(w)
	}

	// Apply limit if specified
	if req.Limit > 0 && int32(len(protoWords)) > req.Limit {
		protoWords = protoWords[:req.Limit]
	}

	return &pb.ListWordsResponse{Words: protoWords, Total: int32(len(words))}, nil
}

func (s *WordService) SyncWords(req *pb.SyncWordsRequest, stream pb.DataService_SyncWordsServer) error {
	// Get all words modified since the given timestamp
	words, err := s.repo.FindModifiedSince(req.SinceTimestamp)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get modified words: %v", err)
	}

	// Stream each modified word to the client
	for _, word := range words {
		if err := stream.Send(&pb.SyncWordsResponse{
			Word: convertModelToProto(word),
		}); err != nil {
			return status.Errorf(codes.Internal, "failed to send word: %v", err)
		}
	}

	return nil
}

func convertModelToProto(word *model.Word) *pb.Word {
	pbWord := &pb.Word{
		Id:        word.ID,
		English:   word.English,
		CreatedAt: word.CreatedAt,
		UpdatedAt: word.UpdatedAt,
		LoadCount: int32(word.LoadCount),
	}

	if word.Chinese != nil {
		pbWord.Chinese = *word.Chinese
	}
	if word.Pronunciation != nil {
		pbWord.Pronunciation = *word.Pronunciation
	}
	if word.DeletedAt != nil {
		pbWord.DeletedAt = *word.DeletedAt
	}

	return pbWord
}
